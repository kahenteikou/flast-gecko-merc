/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 4 -*- */
/* vim: set ts=8 sts=4 et sw=4 tw=99: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "xpcprivate.h"
#include "WrapperFactory.h"
#include "AccessCheck.h"
#include "jsfriendapi.h"
#include "jsproxy.h"
#include "jswrapper.h"
#include "js/StructuredClone.h"
#include "mozilla/dom/BindingUtils.h"
#include "nsGlobalWindow.h"
#include "nsJSUtils.h"
#include "nsIDOMFile.h"
#include "nsIDOMFileList.h"

using namespace mozilla;
using namespace JS;
using namespace js;

namespace xpc {

bool
IsReflector(JSObject *obj)
{
    return IS_WN_REFLECTOR(obj) || dom::IsDOMObject(obj);
}

enum StackScopedCloneTags {
    SCTAG_BASE = JS_SCTAG_USER_MIN,
    SCTAG_REFLECTOR,
    SCTAG_FUNCTION
};

class MOZ_STACK_CLASS StackScopedCloneData {
public:
    StackScopedCloneData(JSContext *aCx, StackScopedCloneOptions *aOptions)
        : mOptions(aOptions)
        , mReflectors(aCx)
        , mFunctions(aCx)
    {}

    StackScopedCloneOptions *mOptions;
    AutoObjectVector mReflectors;
    AutoObjectVector mFunctions;
};

static JSObject *
StackScopedCloneRead(JSContext *cx, JSStructuredCloneReader *reader, uint32_t tag,
                     uint32_t data, void *closure)
{
    MOZ_ASSERT(closure, "Null pointer!");
    StackScopedCloneData *cloneData = static_cast<StackScopedCloneData *>(closure);
    if (tag == SCTAG_REFLECTOR) {
        MOZ_ASSERT(!data);

        size_t idx;
        if (!JS_ReadBytes(reader, &idx, sizeof(size_t)))
            return nullptr;

        RootedObject reflector(cx, cloneData->mReflectors[idx]);
        MOZ_ASSERT(reflector, "No object pointer?");
        MOZ_ASSERT(IsReflector(reflector), "Object pointer must be a reflector!");

        if (!JS_WrapObject(cx, &reflector))
            return nullptr;

        return reflector;
    }

    if (tag == SCTAG_FUNCTION) {
      MOZ_ASSERT(data < cloneData->mFunctions.length());

      RootedValue functionValue(cx);
      RootedObject obj(cx, cloneData->mFunctions[data]);

      if (!JS_WrapObject(cx, &obj))
          return nullptr;

      if (!xpc::NewFunctionForwarder(cx, JSID_VOIDHANDLE, obj, &functionValue))
          return nullptr;

      return &functionValue.toObject();
    }

    MOZ_ASSERT_UNREACHABLE("Encountered garbage in the clone stream!");
    return nullptr;
}

// The HTML5 structured cloning algorithm includes a few DOM objects, notably
// Blob and FileList. That wouldn't in itself be a reason to support them here,
// but we've historically supported them for Cu.cloneInto (where we didn't support
// other reflectors), so we need to continue to do so in the wrapReflectors == false
// case to maintain compatibility.
//
// Blob and FileList clones are supposed to give brand new objects, rather than
// cross-compartment wrappers. For this, our current implementation relies on the
// fact that these objects are implemented with XPConnect and have one reflector
// per scope. This will need to be fixed when Blob and File move to WebIDL. See
// bug 827823 comment 6.
bool IsBlobOrFileList(JSObject *obj)
{
    nsISupports *supports = UnwrapReflectorToISupports(obj);
    if (!supports)
        return false;
    nsCOMPtr<nsIDOMBlob> blob = do_QueryInterface(supports);
    if (blob)
        return true;
    nsCOMPtr<nsIDOMFileList> fileList = do_QueryInterface(supports);
    if (fileList)
        return true;
    return false;
}

static bool
StackScopedCloneWrite(JSContext *cx, JSStructuredCloneWriter *writer,
                      Handle<JSObject *> objArg, void *closure)
{
    MOZ_ASSERT(closure, "Null pointer!");
    StackScopedCloneData *cloneData = static_cast<StackScopedCloneData *>(closure);

    // The SpiderMonkey structured clone machinery does a CheckedUnwrap, but
    // doesn't strip off outer windows. Do that to avoid confusing the reflector
    // detection.
    RootedObject obj(cx, JS_ObjectToInnerObject(cx, objArg));
    if ((cloneData->mOptions->wrapReflectors && IsReflector(obj)) ||
        IsBlobOrFileList(obj))
    {
        if (!cloneData->mReflectors.append(obj))
            return false;

        size_t idx = cloneData->mReflectors.length() - 1;
        if (!JS_WriteUint32Pair(writer, SCTAG_REFLECTOR, 0))
            return false;
        if (!JS_WriteBytes(writer, &idx, sizeof(size_t)))
            return false;
        return true;
    }

    if (JS_ObjectIsCallable(cx, obj)) {
        if (cloneData->mOptions->cloneFunctions) {
            cloneData->mFunctions.append(obj);
            return JS_WriteUint32Pair(writer, SCTAG_FUNCTION, cloneData->mFunctions.length() - 1);
        } else {
            JS_ReportError(cx, "Permission denied to pass a Function via structured clone");
            return false;
        }
    }

    JS_ReportError(cx, "Encountered unsupported value type writing stack-scoped structured clone");
    return false;
}

static const JSStructuredCloneCallbacks gStackScopedCloneCallbacks = {
    StackScopedCloneRead,
    StackScopedCloneWrite,
    nullptr,
    nullptr,
    nullptr,
    nullptr
};

/*
 * General-purpose structured-cloning utility for cases where the structured
 * clone buffer is only used in stack-scope (that is to say, the buffer does
 * not escape from this function). The stack-scoping allows us to pass
 * references to various JSObjects directly in certain situations without
 * worrying about lifetime issues.
 *
 * This function assumes that |cx| is already entered the compartment we want
 * to clone to, and that |val| may not be same-compartment with cx. When the
 * function returns, |val| is set to the result of the clone.
 */
bool
StackScopedClone(JSContext *cx, StackScopedCloneOptions &options,
                 MutableHandleValue val)
{
    JSAutoStructuredCloneBuffer buffer;
    StackScopedCloneData data(cx, &options);
    {
        // For parsing val we have to enter its compartment.
        // (unless it's a primitive)
        Maybe<JSAutoCompartment> ac;
        if (val.isObject()) {
            ac.construct(cx, &val.toObject());
        } else if (val.isString() && !JS_WrapValue(cx, val)) {
            return false;
        }

        if (!buffer.write(cx, val, &gStackScopedCloneCallbacks, &data))
            return false;
    }

    // Now recreate the clones in the target compartment.
    return buffer.read(cx, val, &gStackScopedCloneCallbacks, &data);
}

// Note - This function mirrors the logic of CheckPassToChrome in
// ChromeObjectWrapper.cpp.
static bool
CheckSameOriginArg(JSContext *cx, HandleValue v)
{
    // Primitives are fine.
    if (!v.isObject())
        return true;
    RootedObject obj(cx, &v.toObject());
    MOZ_ASSERT(js::GetObjectCompartment(obj) != js::GetContextCompartment(cx),
               "This should be invoked after entering the compartment but before "
               "wrapping the values");

    // Non-wrappers are fine.
    if (!js::IsWrapper(obj))
        return true;

    // Wrappers leading back to the scope of the exported function are fine.
    if (js::GetObjectCompartment(js::UncheckedUnwrap(obj)) == js::GetContextCompartment(cx))
        return true;

    // Same-origin wrappers are fine.
    if (AccessCheck::wrapperSubsumes(obj))
        return true;

    // Badness.
    JS_ReportError(cx, "Permission denied to pass object to exported function");
    return false;
}

static bool
FunctionForwarder(JSContext *cx, unsigned argc, Value *vp)
{
    CallArgs args = CallArgsFromVp(argc, vp);

    RootedValue v(cx, js::GetFunctionNativeReserved(&args.callee(), 0));
    RootedObject unwrappedFun(cx, js::UncheckedUnwrap(&v.toObject()));

    RootedObject thisObj(cx, JS_THIS_OBJECT(cx, vp));
    if (!thisObj) {
        return false;
    }

    {
        // We manually implement the contents of CrossCompartmentWrapper::call
        // here, because certain function wrappers (notably content->nsEP) are
        // not callable.
        JSAutoCompartment ac(cx, unwrappedFun);

        RootedValue thisVal(cx, ObjectValue(*thisObj));
        if (!CheckSameOriginArg(cx, thisVal) || !JS_WrapObject(cx, &thisObj))
            return false;

        for (size_t n = 0;  n < args.length(); ++n) {
            if (!CheckSameOriginArg(cx, args[n]) || !JS_WrapValue(cx, args[n]))
                return false;
        }

        RootedValue fval(cx, ObjectValue(*unwrappedFun));
        if (!JS_CallFunctionValue(cx, thisObj, fval, args, args.rval()))
            return false;
    }

    // Rewrap the return value into our compartment.
    return JS_WrapValue(cx, args.rval());
}

bool
NewFunctionForwarder(JSContext *cx, HandleId idArg, HandleObject callable,
                     MutableHandleValue vp)
{
    RootedId id(cx, idArg);
    if (id == JSID_VOIDHANDLE)
        id = GetRTIdByIndex(cx, XPCJSRuntime::IDX_EMPTYSTRING);

    JSFunction *fun = js::NewFunctionByIdWithReserved(cx, FunctionForwarder,
                                                      0,0, JS::CurrentGlobalOrNull(cx), id);
    if (!fun)
        return false;

    JSObject *funobj = JS_GetFunctionObject(fun);
    js::SetFunctionNativeReserved(funobj, 0, ObjectValue(*callable));
    vp.setObject(*funobj);
    return true;
}

bool
ExportFunction(JSContext *cx, HandleValue vfunction, HandleValue vscope, HandleValue voptions,
               MutableHandleValue rval)
{
    bool hasOptions = !voptions.isUndefined();
    if (!vscope.isObject() || !vfunction.isObject() || (hasOptions && !voptions.isObject())) {
        JS_ReportError(cx, "Invalid argument");
        return false;
    }

    RootedObject funObj(cx, &vfunction.toObject());
    RootedObject targetScope(cx, &vscope.toObject());
    ExportFunctionOptions options(cx, hasOptions ? &voptions.toObject() : nullptr);
    if (hasOptions && !options.Parse())
        return false;

    // Restrictions:
    // * We must subsume the scope we are exporting to.
    // * We must subsume the function being exported, because the function
    //   forwarder manually circumvents security wrapper CALL restrictions.
    targetScope = CheckedUnwrap(targetScope);
    funObj = CheckedUnwrap(funObj);
    if (!targetScope || !funObj) {
        JS_ReportError(cx, "Permission denied to export function into scope");
        return false;
    }

    if (js::IsScriptedProxy(targetScope)) {
        JS_ReportError(cx, "Defining property on proxy object is not allowed");
        return false;
    }

    {
        // We need to operate in the target scope from here on, let's enter
        // its compartment.
        JSAutoCompartment ac(cx, targetScope);

        // Unwrapping to see if we have a callable.
        funObj = UncheckedUnwrap(funObj);
        if (!JS_ObjectIsCallable(cx, funObj)) {
            JS_ReportError(cx, "First argument must be a function");
            return false;
        }

        RootedId id(cx, options.defineAs);
        if (JSID_IS_VOID(id)) {
            // If there wasn't any function name specified,
            // copy the name from the function being imported.
            JSFunction *fun = JS_GetObjectFunction(funObj);
            RootedString funName(cx, JS_GetFunctionId(fun));
            if (!funName)
                funName = JS_InternString(cx, "");

            if (!JS_StringToId(cx, funName, &id))
                return false;
        }
        MOZ_ASSERT(JSID_IS_STRING(id));

        // The function forwarder will live in the target compartment. Since
        // this function will be referenced from its private slot, to avoid a
        // GC hazard, we must wrap it to the same compartment.
        if (!JS_WrapObject(cx, &funObj))
            return false;

        // And now, let's create the forwarder function in the target compartment
        // for the function the be exported.
        if (!NewFunctionForwarder(cx, id, funObj, rval)) {
            JS_ReportError(cx, "Exporting function failed");
            return false;
        }

        // We have the forwarder function in the target compartment. If
        // defineAs was set, we also need to define it as a property on
        // the target.
        if (!JSID_IS_VOID(options.defineAs)) {
            if (!JS_DefinePropertyById(cx, targetScope, id, rval, JSPROP_ENUMERATE,
                                       JS_PropertyStub, JS_StrictPropertyStub)) {
                return false;
            }
        }
    }

    // Finally we have to re-wrap the exported function back to the caller compartment.
    if (!JS_WrapValue(cx, rval))
        return false;

    return true;
}

bool
CreateObjectIn(JSContext *cx, HandleValue vobj, CreateObjectInOptions &options,
               MutableHandleValue rval)
{
    if (!vobj.isObject()) {
        JS_ReportError(cx, "Expected an object as the target scope");
        return false;
    }

    RootedObject scope(cx, js::CheckedUnwrap(&vobj.toObject()));
    if (!scope) {
        JS_ReportError(cx, "Permission denied to create object in the target scope");
        return false;
    }

    bool define = !JSID_IS_VOID(options.defineAs);

    if (define && js::IsScriptedProxy(scope)) {
        JS_ReportError(cx, "Defining property on proxy object is not allowed");
        return false;
    }

    RootedObject obj(cx);
    {
        JSAutoCompartment ac(cx, scope);
        obj = JS_NewObject(cx, nullptr, JS::NullPtr(), scope);
        if (!obj)
            return false;

        if (define) {
            if (!JS_DefinePropertyById(cx, scope, options.defineAs, obj, JSPROP_ENUMERATE,
                                       JS_PropertyStub, JS_StrictPropertyStub))
                return false;
        }
    }

    rval.setObject(*obj);
    if (!WrapperFactory::WaiveXrayAndWrap(cx, rval))
        return false;

    return true;
}

} /* namespace xpc */
