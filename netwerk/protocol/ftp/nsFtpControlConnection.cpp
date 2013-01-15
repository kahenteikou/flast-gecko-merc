/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 4 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "nsIOService.h"
#include "nsFTPChannel.h"
#include "nsFtpControlConnection.h"
#include "nsFtpProtocolHandler.h"
#include "prlog.h"
#include "nsIPipe.h"
#include "nsIInputStream.h"
#include "nsISocketTransportService.h"
#include "nsISocketTransport.h"
#include "nsNetUtil.h"
#include "nsThreadUtils.h"
#include "nsCRT.h"
#include <algorithm>

#if defined(PR_LOGGING)
extern PRLogModuleInfo* gFTPLog;
#endif
#define LOG(args)         PR_LOG(gFTPLog, PR_LOG_DEBUG, args)
#define LOG_ALWAYS(args)  PR_LOG(gFTPLog, PR_LOG_ALWAYS, args)

//
// nsFtpControlConnection implementation ...
//

NS_IMPL_ISUPPORTS1(nsFtpControlConnection, nsIInputStreamCallback)

NS_IMETHODIMP
nsFtpControlConnection::OnInputStreamReady(nsIAsyncInputStream *stream)
{
    char data[4096];

    // Consume data whether we have a listener or not.
    uint64_t avail64;
    uint32_t avail;
    nsresult rv = stream->Available(&avail64);
    if (NS_SUCCEEDED(rv)) {
        avail = (uint32_t)std::min(avail64, (uint64_t)sizeof(data));

        uint32_t n;
        rv = stream->Read(data, avail, &n);
        if (NS_SUCCEEDED(rv))
            avail = n;
    }

    // It's important that we null out mListener before calling one of its
    // methods as it may call WaitData, which would queue up another read.

    nsRefPtr<nsFtpControlConnectionListener> listener;
    listener.swap(mListener);

    if (!listener)
        return NS_OK;

    if (NS_FAILED(rv)) {
        listener->OnControlError(rv);
    } else {
        listener->OnControlDataAvailable(data, avail);
    }

    return NS_OK;
}

nsFtpControlConnection::nsFtpControlConnection(const nsCSubstring& host,
                                               uint32_t port)
    : mServerType(0), mSessionId(gFtpHandler->GetSessionId()), mHost(host)
    , mPort(port)
{
    LOG_ALWAYS(("FTP:CC created @%p", this));
}

nsFtpControlConnection::~nsFtpControlConnection() 
{
    LOG_ALWAYS(("FTP:CC destroyed @%p", this));
}

bool
nsFtpControlConnection::IsAlive()
{
    if (!mSocket) 
        return false;

    bool isAlive = false;
    mSocket->IsAlive(&isAlive);
    return isAlive;
}
nsresult 
nsFtpControlConnection::Connect(nsIProxyInfo* proxyInfo,
                                nsITransportEventSink* eventSink)
{
    if (mSocket)
        return NS_OK;

    // build our own
    nsresult rv;
    nsCOMPtr<nsISocketTransportService> sts =
            do_GetService(NS_SOCKETTRANSPORTSERVICE_CONTRACTID, &rv);
    if (NS_FAILED(rv))
        return rv;

    rv = sts->CreateTransport(nullptr, 0, mHost, mPort, proxyInfo,
                              getter_AddRefs(mSocket)); // the command transport
    if (NS_FAILED(rv))
        return rv;

    mSocket->SetQoSBits(gFtpHandler->GetControlQoSBits());

    // proxy transport events back to current thread
    if (eventSink)
        mSocket->SetEventSink(eventSink, NS_GetCurrentThread());

    // open buffered, blocking output stream to socket.  so long as commands
    // do not exceed 1024 bytes in length, the writing thread (the main thread)
    // will not block.  this should be OK.
    rv = mSocket->OpenOutputStream(nsITransport::OPEN_BLOCKING, 1024, 1,
                                   getter_AddRefs(mSocketOutput));
    if (NS_FAILED(rv))
        return rv;

    // open buffered, non-blocking/asynchronous input stream to socket.
    nsCOMPtr<nsIInputStream> inStream;
    rv = mSocket->OpenInputStream(0,
                                  nsIOService::gDefaultSegmentSize,
                                  nsIOService::gDefaultSegmentCount,
                                  getter_AddRefs(inStream));
    if (NS_SUCCEEDED(rv))
        mSocketInput = do_QueryInterface(inStream);
    
    return rv;
}

nsresult
nsFtpControlConnection::WaitData(nsFtpControlConnectionListener *listener)
{
    LOG(("FTP:(%p) wait data [listener=%p]\n", this, listener));

    // If listener is null, then simply disconnect the listener.  Otherwise,
    // ensure that we are listening.
    if (!listener) {
        mListener = nullptr;
        return NS_OK;
    }

    NS_ENSURE_STATE(mSocketInput);

    mListener = listener;
    return mSocketInput->AsyncWait(this, 0, 0, NS_GetCurrentThread());
}

nsresult 
nsFtpControlConnection::Disconnect(nsresult status)
{
    if (!mSocket)
        return NS_OK;  // already disconnected
    
    LOG_ALWAYS(("FTP:(%p) CC disconnecting (%x)", this, status));

    if (NS_FAILED(status)) {
        // break cyclic reference!
        mSocket->Close(status);
        mSocket = 0;
        mSocketInput->AsyncWait(nullptr, 0, 0, nullptr);  // clear any observer
        mSocketInput = nullptr;
        mSocketOutput = nullptr;
    }

    return NS_OK;
}

nsresult 
nsFtpControlConnection::Write(const nsCSubstring& command)
{
    NS_ENSURE_STATE(mSocketOutput);

    uint32_t len = command.Length();
    uint32_t cnt;
    nsresult rv = mSocketOutput->Write(command.Data(), len, &cnt);

    if (NS_FAILED(rv))
        return rv;

    if (len != cnt)
        return NS_ERROR_FAILURE;
    
    return NS_OK;
}
