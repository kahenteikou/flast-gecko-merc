/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef nsDOMQS_h__
#define nsDOMQS_h__

#include "nsDOMClassInfoID.h"
#include "nsGenericHTMLElement.h"
#include "mozilla/dom/HTMLCanvasElement.h"
#include "mozilla/dom/HTMLFormElement.h"
#include "mozilla/dom/HTMLImageElement.h"
#include "mozilla/dom/HTMLOptionElement.h"
#include "HTMLOptGroupElement.h"
#include "mozilla/dom/HTMLVideoElement.h"
#include "nsHTMLDocument.h"
#include "nsICSSDeclaration.h"
#include "nsSVGElement.h"
#include "mozilla/dom/Event.h"
#include "mozilla/dom/UIEvent.h"
#include "mozilla/dom/MouseEvent.h"
#include "mozilla/dom/EventTargetBinding.h"
#include "mozilla/dom/NodeBinding.h"
#include "mozilla/dom/ElementBinding.h"
#include "mozilla/dom/HTMLElementBinding.h"
#include "mozilla/dom/DocumentBinding.h"
#include "mozilla/dom/SVGElementBinding.h"
#include "mozilla/dom/HTMLDocumentBinding.h"
#include "XPCQuickStubs.h"
#include "nsGlobalWindow.h"

template<class T>
struct ProtoIDAndDepth
{
    enum {
        PrototypeID = mozilla::dom::prototypes::id::_ID_Count,
        Depth = -1
    };
};

#define NEW_BINDING(_native, _id)                                             \
template<>                                                                    \
struct ProtoIDAndDepth<_native>                                               \
{                                                                             \
    enum {                                                                    \
        PrototypeID = mozilla::dom::prototypes::id::_id,                      \
        Depth = mozilla::dom::PrototypeTraits<                                \
            static_cast<mozilla::dom::prototypes::ID>(PrototypeID)>::Depth    \
    };                                                                        \
}

NEW_BINDING(mozilla::dom::EventTarget, EventTarget);
NEW_BINDING(nsINode, Node);
NEW_BINDING(mozilla::dom::Element, Element);
NEW_BINDING(nsGenericHTMLElement, HTMLElement);
NEW_BINDING(nsIDocument, Document);
NEW_BINDING(nsDocument, Document);
NEW_BINDING(nsHTMLDocument, HTMLDocument);
NEW_BINDING(nsSVGElement, SVGElement);
NEW_BINDING(mozilla::dom::Event, Event);
NEW_BINDING(mozilla::dom::UIEvent, UIEvent);
NEW_BINDING(mozilla::dom::MouseEvent, MouseEvent);

#define DEFINE_UNWRAP_CAST(_interface, _base, _bit)                           \
template <>                                                                   \
MOZ_ALWAYS_INLINE bool                                                        \
xpc_qsUnwrapThis<_interface>(JSContext *cx,                                   \
                             JS::HandleObject obj,                            \
                             _interface **ppThis,                             \
                             nsISupports **pThisRef,                          \
                             JS::MutableHandleValue pThisVal,                 \
                             bool failureFatal)                               \
{                                                                             \
    nsresult rv;                                                              \
    nsISupports *native =                                                     \
        castNativeFromWrapper(cx, obj, _bit,                                  \
                              ProtoIDAndDepth<_interface>::PrototypeID,       \
                              ProtoIDAndDepth<_interface>::Depth,             \
                              pThisRef, pThisVal, &rv);                       \
    *ppThis = nullptr;  /* avoids uninitialized warnings in callers */        \
    if (failureFatal && !native)                                              \
        return xpc_qsThrow(cx, rv);                                           \
    *ppThis = static_cast<_interface*>(static_cast<_base*>(native));          \
    return true;                                                              \
}                                                                             \
                                                                              \
template <>                                                                   \
MOZ_ALWAYS_INLINE nsresult                                                    \
xpc_qsUnwrapArg<_interface>(JSContext *cx,                                    \
                            JS::HandleValue v,                                \
                            _interface **ppArg,                               \
                            nsISupports **ppArgRef,                           \
                            JS::MutableHandleValue vp)                        \
{                                                                             \
    nsresult rv;                                                              \
    nsISupports *native =                                                     \
        castNativeArgFromWrapper(cx, v, _bit,                                 \
                                 ProtoIDAndDepth<_interface>::PrototypeID,    \
                                 ProtoIDAndDepth<_interface>::Depth,          \
                                 ppArgRef, vp, &rv);                          \
    if (NS_SUCCEEDED(rv))                                                     \
        *ppArg = static_cast<_interface*>(static_cast<_base*>(native));       \
    return rv;                                                                \
}                                                                             \
                                                                              \
template <>                                                                   \
inline nsresult                                                               \
xpc_qsUnwrapArg<_interface>(JSContext *cx,                                    \
                            JS::HandleValue v,                                \
                            _interface **ppArg,                               \
                            _interface **ppArgRef,                            \
                            JS::MutableHandleValue vp)                        \
{                                                                             \
    nsISupports* argRef = static_cast<_base*>(*ppArgRef);                     \
    nsresult rv = xpc_qsUnwrapArg<_interface>(cx, v, ppArg, &argRef, vp);     \
    *ppArgRef = static_cast<_interface*>(static_cast<_base*>(argRef));        \
    return rv;                                                                \
}                                                                             \
                                                                              \
namespace mozilla {                                                           \
namespace dom {                                                               \
                                                                              \
template <>                                                                   \
MOZ_ALWAYS_INLINE nsresult                                                    \
UnwrapArg<_interface>(JSContext *cx,                                          \
                      JS::HandleValue v,                                      \
                      _interface **ppArg,                                     \
                      nsISupports **ppArgRef,                                 \
                      JS::MutableHandleValue vp)                              \
{                                                                             \
  return xpc_qsUnwrapArg<_interface>(cx, v, ppArg, ppArgRef, vp);             \
}                                                                             \
                                                                              \
template <>                                                                   \
inline nsresult                                                               \
UnwrapArg<_interface>(JSContext *cx,                                          \
                      JS::HandleValue v,                                      \
                      _interface **ppArg,                                     \
                      _interface **ppArgRef,                                  \
                      JS::MutableHandleValue vp)                              \
{                                                                             \
  return xpc_qsUnwrapArg<_interface>(cx, v, ppArg, ppArgRef, vp);             \
}                                                                             \
                                                                              \
} /* namespace dom */                                                         \
} /* namespace mozilla */

#undef DOMCI_CASTABLE_INTERFACE

#undef DOMCI_CASTABLE_INTERFACE
#define DOMCI_CASTABLE_INTERFACE(_interface, _base, _bit, _extra)             \
  DEFINE_UNWRAP_CAST(_interface, _base, _bit)

DOMCI_CASTABLE_INTERFACES(unused)

#undef DOMCI_CASTABLE_INTERFACE

inline nsresult
xpc_qsUnwrapArg_HTMLElement(JSContext *cx,
                            JS::HandleValue v,
                            nsIAtom *aTag,
                            nsIContent **ppArg,
                            nsISupports **ppArgRef,
                            JS::MutableHandleValue vp)
{
    nsGenericHTMLElement *elem;
    JS::RootedValue val(cx);
    nsresult rv =
        xpc_qsUnwrapArg<nsGenericHTMLElement>(cx, v, &elem, ppArgRef, &val);
    if (NS_SUCCEEDED(rv)) {
        if (elem->IsHTML(aTag)) {
            *ppArg = elem;
            vp.set(val);
        } else {
            rv = NS_ERROR_XPC_BAD_CONVERT_JS;
        }
    }
    return rv;
}

#define DEFINE_UNWRAP_CAST_HTML(_tag, _clazz)                                 \
template <>                                                                   \
inline nsresult                                                               \
xpc_qsUnwrapArg<_clazz>(JSContext *cx,                                        \
                        JS::HandleValue v,                                    \
                        _clazz **ppArg,                                       \
                        nsISupports **ppArgRef,                               \
                        JS::MutableHandleValue vp)                            \
{                                                                             \
    nsIContent *elem;                                                         \
    nsresult rv = xpc_qsUnwrapArg_HTMLElement(cx, v, nsGkAtoms::_tag, &elem,  \
                                              ppArgRef, vp);                  \
    if (NS_SUCCEEDED(rv))                                                     \
        *ppArg = static_cast<_clazz*>(elem);                                  \
    return rv;                                                                \
}                                                                             \
                                                                              \
template <>                                                                   \
inline nsresult                                                               \
xpc_qsUnwrapArg<_clazz>(JSContext *cx, JS::HandleValue v, _clazz **ppArg,     \
                        _clazz **ppArgRef, JS::MutableHandleValue vp)         \
{                                                                             \
    nsISupports* argRef = static_cast<nsIContent*>(*ppArgRef);                \
    nsresult rv = xpc_qsUnwrapArg<_clazz>(cx, v, ppArg, &argRef, vp);         \
    *ppArgRef = static_cast<_clazz*>(static_cast<nsIContent*>(argRef));       \
    return rv;                                                                \
}                                                                             \
                                                                              \
namespace mozilla {                                                           \
namespace dom {                                                               \
                                                                              \
template <>                                                                   \
inline nsresult                                                               \
UnwrapArg<_clazz>(JSContext *cx,                                              \
                  JS::HandleValue v,                                          \
                  _clazz **ppArg,                                             \
                  nsISupports **ppArgRef,                                     \
                  JS::MutableHandleValue vp)                                  \
{                                                                             \
    return xpc_qsUnwrapArg<_clazz>(cx, v, ppArg, ppArgRef, vp);               \
}                                                                             \
                                                                              \
template <>                                                                   \
inline nsresult                                                               \
UnwrapArg<_clazz>(JSContext *cx, JS::HandleValue v, _clazz **ppArg,           \
                  _clazz **ppArgRef, JS::MutableHandleValue vp)               \
{                                                                             \
    return xpc_qsUnwrapArg<_clazz>(cx, v, ppArg, ppArgRef, vp);               \
}                                                                             \
                                                                              \
} /* namespace dom */                                                         \
} /* namespace mozilla */

DEFINE_UNWRAP_CAST_HTML(canvas, mozilla::dom::HTMLCanvasElement)
DEFINE_UNWRAP_CAST_HTML(form, mozilla::dom::HTMLFormElement)
DEFINE_UNWRAP_CAST_HTML(img, mozilla::dom::HTMLImageElement)
DEFINE_UNWRAP_CAST_HTML(optgroup, mozilla::dom::HTMLOptGroupElement)
DEFINE_UNWRAP_CAST_HTML(option, mozilla::dom::HTMLOptionElement)
DEFINE_UNWRAP_CAST_HTML(video, mozilla::dom::HTMLVideoElement)

inline nsISupports*
ToSupports(nsContentList *p)
{
    return static_cast<nsINodeList*>(p);
}

inline nsISupports*
ToCanonicalSupports(nsContentList *p)
{
    return static_cast<nsINodeList*>(p);
}

#endif /* nsDOMQS_h__ */
