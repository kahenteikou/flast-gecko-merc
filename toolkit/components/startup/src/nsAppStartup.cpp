/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Mozilla Communicator client code. This file was split
 * from xpfe/appshell/src/nsAppShellService.cpp
 *
 * The Initial Developer of the Original Code is
 * Netscape Communications Corporation.
 * Portions created by the Initial Developer are Copyright (C) 1998
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Pierre Phaneuf <pp@ludusdesign.com>
 *   Robert O'Callahan <roc+moz@cs.cmu.edu>
 *   Benjamin Smedberg <bsmedberg@covad.net>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either of the GNU General Public License Version 2 or later (the "GPL"),
 * or the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

#include "nsAppStartup.h"

#include "nsIAppShellService.h"
#include "nsPIDOMWindow.h"
#include "nsIDOMWindowInternal.h"
#include "nsIInterfaceRequestor.h"
#include "nsILocalFile.h"
#include "nsIObserverService.h"
#include "nsIPrefBranch.h"
#include "nsIPrefService.h"
#include "nsIProfileChangeStatus.h"
#include "nsIPromptService.h"
#include "nsIStringBundle.h"
#include "nsISupportsPrimitives.h"
#include "nsITimelineService.h"
#include "nsIWebBrowserChrome.h"
#include "nsIWindowMediator.h"
#include "nsIWindowWatcher.h"
#include "nsIXULWindow.h"
#include "nsNativeCharsetUtils.h"
#include "nsThreadUtils.h"
#include "nsAutoPtr.h"
#include "nsStringGlue.h"

#include "prprf.h"
#include "nsCRT.h"
#include "nsIInterfaceRequestorUtils.h"
#include "nsWidgetsCID.h"
#include "nsAppShellCID.h"
#include "mozilla/Services.h"
#include "mozilla/storage.h"
#include "mozilla/FunctionTimer.h"
#include "nsAppDirectoryServiceDefs.h"
#include "nsIXULRuntime.h"
#include "nsXPCOMCIDInternal.h"

static NS_DEFINE_CID(kAppShellCID, NS_APPSHELL_CID);

class nsAppExitEvent : public nsRunnable {
private:
  nsRefPtr<nsAppStartup> mService;

public:
  nsAppExitEvent(nsAppStartup *service) : mService(service) {}

  NS_IMETHOD Run() {
    // Tell the appshell to exit
    mService->mAppShell->Exit();

    // We're done "shutting down".
    mService->mShuttingDown = PR_FALSE;
    mService->mRunning = PR_FALSE;
    return NS_OK;
  }
};

nsresult RecordStartupDuration();
nsresult OpenStartupDatabase(mozIStorageConnection **db);
nsresult EnsureTable(mozIStorageConnection *db, const nsACString &table, const nsACString &schema);

//
// nsAppStartup
//

nsAppStartup::nsAppStartup() :
  mConsiderQuitStopper(0),
  mRunning(PR_FALSE),
  mShuttingDown(PR_FALSE),
  mAttemptingQuit(PR_FALSE),
  mRestart(PR_FALSE)
{ }


nsresult
nsAppStartup::Init()
{
  NS_TIME_FUNCTION;
  nsresult rv;

  // Create widget application shell
  mAppShell = do_GetService(kAppShellCID, &rv);
  NS_ENSURE_SUCCESS(rv, rv);

  NS_TIME_FUNCTION_MARK("Got AppShell service");

  nsCOMPtr<nsIObserverService> os =
    mozilla::services::GetObserverService();
  if (!os)
    return NS_ERROR_FAILURE;

  NS_TIME_FUNCTION_MARK("Got Observer service");

  os->AddObserver(this, "quit-application-forced", PR_TRUE);
  os->AddObserver(this, "sessionstore-browser-state-restored", PR_TRUE);
  os->AddObserver(this, "sessionstore-windows-restored", PR_TRUE);
  os->AddObserver(this, "profile-change-teardown", PR_TRUE);
  os->AddObserver(this, "xul-window-registered", PR_TRUE);
  os->AddObserver(this, "xul-window-destroyed", PR_TRUE);

  return NS_OK;
}


//
// nsAppStartup->nsISupports
//

NS_IMPL_THREADSAFE_ISUPPORTS6(nsAppStartup,
                              nsIAppStartup,
                              nsIAppStartup2,
                              nsIWindowCreator,
                              nsIWindowCreator2,
                              nsIObserver,
                              nsISupportsWeakReference)


//
// nsAppStartup->nsIAppStartup
//

NS_IMETHODIMP
nsAppStartup::CreateHiddenWindow()
{
  nsCOMPtr<nsIAppShellService> appShellService
    (do_GetService(NS_APPSHELLSERVICE_CONTRACTID));
  NS_ENSURE_TRUE(appShellService, NS_ERROR_FAILURE);

  return appShellService->CreateHiddenWindow(mAppShell);
}


NS_IMETHODIMP
nsAppStartup::DestroyHiddenWindow()
{
  nsCOMPtr<nsIAppShellService> appShellService
    (do_GetService(NS_APPSHELLSERVICE_CONTRACTID));
  NS_ENSURE_TRUE(appShellService, NS_ERROR_FAILURE);

  return appShellService->DestroyHiddenWindow();
}

NS_IMETHODIMP
nsAppStartup::Run(void)
{
  NS_ASSERTION(!mRunning, "Reentrant appstartup->Run()");

  // If we have no windows open and no explicit calls to
  // enterLastWindowClosingSurvivalArea, or somebody has explicitly called
  // quit, don't bother running the event loop which would probably leave us
  // with a zombie process.

  if (!mShuttingDown && mConsiderQuitStopper != 0) {
#ifdef XP_MACOSX
    EnterLastWindowClosingSurvivalArea();
#endif

    mRunning = PR_TRUE;

    nsresult rv = mAppShell->Run();
    if (NS_FAILED(rv))
      return rv;
  }

  return mRestart ? NS_SUCCESS_RESTART_APP : NS_OK;
}


NS_IMETHODIMP
nsAppStartup::Quit(PRUint32 aMode)
{
  PRUint32 ferocity = (aMode & 0xF);

  // Quit the application. We will asynchronously call the appshell's
  // Exit() method via nsAppExitEvent to allow one last pass
  // through any events in the queue. This guarantees a tidy cleanup.
  nsresult rv = NS_OK;
  PRBool postedExitEvent = PR_FALSE;

  if (mShuttingDown)
    return NS_OK;

  // If we're considering quitting, we will only do so if:
  if (ferocity == eConsiderQuit) {
    if (mConsiderQuitStopper == 0) {
      // there are no windows...
      ferocity = eAttemptQuit;
    }
#ifdef XP_MACOSX
    else if (mConsiderQuitStopper == 1) {
      // ... or there is only a hiddenWindow left, and it's useless:
      nsCOMPtr<nsIAppShellService> appShell
        (do_GetService(NS_APPSHELLSERVICE_CONTRACTID));

      // Failure shouldn't be fatal, but will abort quit attempt:
      if (!appShell)
        return NS_OK;

      PRBool usefulHiddenWindow;
      appShell->GetApplicationProvidedHiddenWindow(&usefulHiddenWindow);
      nsCOMPtr<nsIXULWindow> hiddenWindow;
      appShell->GetHiddenWindow(getter_AddRefs(hiddenWindow));
      // If the one window is useful, we won't quit:
      if (!hiddenWindow || usefulHiddenWindow)
        return NS_OK;

      ferocity = eAttemptQuit;
    }
#endif
  }

  nsCOMPtr<nsIObserverService> obsService;
  if (ferocity == eAttemptQuit || ferocity == eForceQuit) {

    nsCOMPtr<nsISimpleEnumerator> windowEnumerator;
    nsCOMPtr<nsIWindowMediator> mediator (do_GetService(NS_WINDOWMEDIATOR_CONTRACTID));
    if (mediator) {
      mediator->GetEnumerator(nsnull, getter_AddRefs(windowEnumerator));
      if (windowEnumerator) {
        PRBool more;
        while (windowEnumerator->HasMoreElements(&more), more) {
          nsCOMPtr<nsISupports> window;
          windowEnumerator->GetNext(getter_AddRefs(window));
          nsCOMPtr<nsPIDOMWindow> domWindow(do_QueryInterface(window));
          if (domWindow) {
            if (!domWindow->CanClose())
              return NS_OK;
          }
        }
      }
    }

    mShuttingDown = PR_TRUE;
    if (!mRestart)
      mRestart = (aMode & eRestart) != 0;

    obsService = mozilla::services::GetObserverService();

    if (!mAttemptingQuit) {
      mAttemptingQuit = PR_TRUE;
#ifdef XP_MACOSX
      // now even the Mac wants to quit when the last window is closed
      ExitLastWindowClosingSurvivalArea();
#endif
      if (obsService)
        obsService->NotifyObservers(nsnull, "quit-application-granted", nsnull);
    }

    /* Enumerate through each open window and close it. It's important to do
       this before we forcequit because this can control whether we really quit
       at all. e.g. if one of these windows has an unload handler that
       opens a new window. Ugh. I know. */
    CloseAllWindows();

    if (mediator) {
      if (ferocity == eAttemptQuit) {
        ferocity = eForceQuit; // assume success

        /* Were we able to immediately close all windows? if not, eAttemptQuit
           failed. This could happen for a variety of reasons; in fact it's
           very likely. Perhaps we're being called from JS and the window->Close
           method hasn't had a chance to wrap itself up yet. So give up.
           We'll return (with eConsiderQuit) as the remaining windows are
           closed. */
        mediator->GetEnumerator(nsnull, getter_AddRefs(windowEnumerator));
        if (windowEnumerator) {
          PRBool more;
          while (windowEnumerator->HasMoreElements(&more), more) {
            /* we can't quit immediately. we'll try again as the last window
               finally closes. */
            ferocity = eAttemptQuit;
            nsCOMPtr<nsISupports> window;
            windowEnumerator->GetNext(getter_AddRefs(window));
            nsCOMPtr<nsIDOMWindowInternal> domWindow(do_QueryInterface(window));
            if (domWindow) {
              PRBool closed = PR_FALSE;
              domWindow->GetClosed(&closed);
              if (!closed) {
                rv = NS_ERROR_FAILURE;
                break;
              }
            }
          }
        }
      }
    }
  }

  if (ferocity == eForceQuit) {
    // do it!

    // No chance of the shutdown being cancelled from here on; tell people
    // we're shutting down for sure while all services are still available.
    if (obsService) {
      NS_NAMED_LITERAL_STRING(shutdownStr, "shutdown");
      NS_NAMED_LITERAL_STRING(restartStr, "restart");
      obsService->NotifyObservers(nsnull, "quit-application",
        mRestart ? restartStr.get() : shutdownStr.get());
    }

    if (!mRunning) {
      postedExitEvent = PR_TRUE;
    }
    else {
      // no matter what, make sure we send the exit event.  If
      // worst comes to worst, we'll do a leaky shutdown but we WILL
      // shut down. Well, assuming that all *this* stuff works ;-).
      nsCOMPtr<nsIRunnable> event = new nsAppExitEvent(this);
      rv = NS_DispatchToCurrentThread(event);
      if (NS_SUCCEEDED(rv)) {
        postedExitEvent = PR_TRUE;
      }
      else {
        NS_WARNING("failed to dispatch nsAppExitEvent");
      }
    }
  }

  // turn off the reentrancy check flag, but not if we have
  // more asynchronous work to do still.
  if (!postedExitEvent)
    mShuttingDown = PR_FALSE;
  return rv;
}


void
nsAppStartup::CloseAllWindows()
{
  nsCOMPtr<nsIWindowMediator> mediator
    (do_GetService(NS_WINDOWMEDIATOR_CONTRACTID));

  nsCOMPtr<nsISimpleEnumerator> windowEnumerator;

  mediator->GetEnumerator(nsnull, getter_AddRefs(windowEnumerator));

  if (!windowEnumerator)
    return;

  PRBool more;
  while (NS_SUCCEEDED(windowEnumerator->HasMoreElements(&more)) && more) {
    nsCOMPtr<nsISupports> isupports;
    if (NS_FAILED(windowEnumerator->GetNext(getter_AddRefs(isupports))))
      break;

    nsCOMPtr<nsPIDOMWindow> window = do_QueryInterface(isupports);
    NS_ASSERTION(window, "not an nsPIDOMWindow");
    if (window)
      window->ForceClose();
  }
}

NS_IMETHODIMP
nsAppStartup::EnterLastWindowClosingSurvivalArea(void)
{
  ++mConsiderQuitStopper;
  return NS_OK;
}


NS_IMETHODIMP
nsAppStartup::ExitLastWindowClosingSurvivalArea(void)
{
  NS_ASSERTION(mConsiderQuitStopper > 0, "consider quit stopper out of bounds");
  --mConsiderQuitStopper;

  if (mRunning)
    Quit(eConsiderQuit);

  return NS_OK;
}

//
// nsAppStartup->nsIAppStartup2
//

NS_IMETHODIMP
nsAppStartup::GetShuttingDown(PRBool *aResult)
{
  *aResult = mShuttingDown;
  return NS_OK;
}

//
// nsAppStartup->nsIWindowCreator
//

NS_IMETHODIMP
nsAppStartup::CreateChromeWindow(nsIWebBrowserChrome *aParent,
                                 PRUint32 aChromeFlags,
                                 nsIWebBrowserChrome **_retval)
{
  PRBool cancel;
  return CreateChromeWindow2(aParent, aChromeFlags, 0, 0, &cancel, _retval);
}


//
// nsAppStartup->nsIWindowCreator2
//

NS_IMETHODIMP
nsAppStartup::CreateChromeWindow2(nsIWebBrowserChrome *aParent,
                                  PRUint32 aChromeFlags,
                                  PRUint32 aContextFlags,
                                  nsIURI *aURI,
                                  PRBool *aCancel,
                                  nsIWebBrowserChrome **_retval)
{
  NS_ENSURE_ARG_POINTER(aCancel);
  NS_ENSURE_ARG_POINTER(_retval);
  *aCancel = PR_FALSE;
  *_retval = 0;

  // Non-modal windows cannot be opened if we are attempting to quit
  if (mAttemptingQuit && (aChromeFlags & nsIWebBrowserChrome::CHROME_MODAL) == 0)
    return NS_ERROR_ILLEGAL_DURING_SHUTDOWN;

  nsCOMPtr<nsIXULWindow> newWindow;

  if (aParent) {
    nsCOMPtr<nsIXULWindow> xulParent(do_GetInterface(aParent));
    NS_ASSERTION(xulParent, "window created using non-XUL parent. that's unexpected, but may work.");

    if (xulParent)
      xulParent->CreateNewWindow(aChromeFlags, mAppShell, getter_AddRefs(newWindow));
    // And if it fails, don't try again without a parent. It could fail
    // intentionally (bug 115969).
  } else { // try using basic methods:
    /* You really shouldn't be making dependent windows without a parent.
      But unparented modal (and therefore dependent) windows happen
      in our codebase, so we allow it after some bellyaching: */
    if (aChromeFlags & nsIWebBrowserChrome::CHROME_DEPENDENT)
      NS_WARNING("dependent window created without a parent");

    nsCOMPtr<nsIAppShellService> appShell(do_GetService(NS_APPSHELLSERVICE_CONTRACTID));
    if (!appShell)
      return NS_ERROR_FAILURE;

    appShell->CreateTopLevelWindow(0, 0, aChromeFlags,
                                   nsIAppShellService::SIZE_TO_CONTENT,
                                   nsIAppShellService::SIZE_TO_CONTENT,
                                   mAppShell, getter_AddRefs(newWindow));
  }

  // if anybody gave us anything to work with, use it
  if (newWindow) {
    newWindow->SetContextFlags(aContextFlags);
    nsCOMPtr<nsIInterfaceRequestor> thing(do_QueryInterface(newWindow));
    if (thing)
      CallGetInterface(thing.get(), _retval);
  }

  return *_retval ? NS_OK : NS_ERROR_FAILURE;
}


//
// nsAppStartup->nsIObserver
//

NS_IMETHODIMP
nsAppStartup::Observe(nsISupports *aSubject,
                      const char *aTopic, const PRUnichar *aData)
{
  NS_ASSERTION(mAppShell, "appshell service notified before appshell built");
  if (!strcmp(aTopic, "quit-application-forced")) {
    mShuttingDown = PR_TRUE;
  }
  else if (!strcmp(aTopic, "profile-change-teardown")) {
    if (!mShuttingDown) {
      EnterLastWindowClosingSurvivalArea();
      CloseAllWindows();
      ExitLastWindowClosingSurvivalArea();
    }
  } else if (!strcmp(aTopic, "xul-window-registered")) {
    EnterLastWindowClosingSurvivalArea();
  } else if (!strcmp(aTopic, "xul-window-destroyed")) {
    ExitLastWindowClosingSurvivalArea();
  } else if ((!strcmp(aTopic, "sessionstore-browser-state-restored")) ||
             (!strcmp(aTopic, "sessionstore-windows-restored"))) {
    RecordStartupDuration();
  } else {
    NS_ERROR("Unexpected observer topic.");
  }

  return NS_OK;
}

nsresult RecordStartupDuration()
{
  nsresult rv;
  nsCOMPtr<nsIXULRuntime> runtime = do_GetService(XULRUNTIME_SERVICE_CONTRACTID);

  PRTime launched, started, finished;
  runtime->GetLaunchTimestamp((PRUint64*)&launched);
  runtime->GetStartupTimestamp((PRUint64*)&started);

  nsCOMPtr<mozIStorageConnection> db;
  rv = OpenStartupDatabase(getter_AddRefs(db));
  NS_ENSURE_SUCCESS(rv, rv);

  rv = EnsureTable(db, NS_LITERAL_CSTRING("duration"),
                   NS_LITERAL_CSTRING("timestamp INTEGER, launch INTEGER, startup INTEGER"));
  NS_ENSURE_SUCCESS(rv, rv);
  rv = EnsureTable(db, NS_LITERAL_CSTRING("events"),
                   NS_LITERAL_CSTRING("timestamp INTEGER, description TEXT"));
  NS_ENSURE_SUCCESS(rv, rv);

  nsCOMPtr<mozIStorageStatement> statement;
  rv = db->CreateStatement(NS_LITERAL_CSTRING("INSERT INTO duration VALUES (?1, ?2, ?3)"),
                           getter_AddRefs(statement));
  NS_ENSURE_SUCCESS(rv, rv);

  rv = statement->BindInt64Parameter(0, launched);
  NS_ENSURE_SUCCESS(rv, rv);
  rv = statement->BindInt64Parameter(1, started - launched);
  NS_ENSURE_SUCCESS(rv, rv);
  finished = PR_Now();
  rv = statement->BindInt64Parameter(2, finished - started);
  NS_ENSURE_SUCCESS(rv, rv);

  statement->Execute();
  return NS_OK;
}

nsresult OpenStartupDatabase(mozIStorageConnection **db)
{
  nsresult rv;
  nsCOMPtr<nsIFile> file;
  rv = NS_GetSpecialDirectory(NS_APP_USER_PROFILE_50_DIR, getter_AddRefs(file));
  NS_ENSURE_SUCCESS(rv, rv);
  rv = file->Append(NS_LITERAL_STRING("startup.sqlite"));
  NS_ENSURE_SUCCESS(rv, rv);
  nsCOMPtr<mozIStorageService> svc = do_GetService(MOZ_STORAGE_SERVICE_CONTRACTID, &rv);
  NS_ENSURE_SUCCESS(rv, rv);

  rv = svc->OpenDatabase(file, db);
  if (NS_ERROR_FILE_CORRUPTED == rv)
  {
    svc->BackupDatabaseFile(file, NS_LITERAL_STRING("startup.sqlite.backup"), nsnull, nsnull);
    rv = svc->OpenDatabase(file, db);
    NS_ENSURE_SUCCESS(rv, rv);
  }
  NS_ENSURE_SUCCESS(rv, rv);
  return NS_OK;
}

nsresult EnsureTable(mozIStorageConnection *db, const nsACString &table, const nsACString &schema)
{
  nsresult rv;
  PRBool exists = false;
  rv = db->TableExists(table, &exists);
  NS_ENSURE_SUCCESS(rv, rv);
  if (!exists)
    rv = db->CreateTable(PromiseFlatCString(table).get(),
                         PromiseFlatCString(schema).get());
  NS_ENSURE_SUCCESS(rv, rv);
  return NS_OK;
}
