/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ts=8 sts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef nsCycleCollectionParticipant_h__
#define nsCycleCollectionParticipant_h__

#include "mozilla/MacroArgs.h"
#include "mozilla/MacroForEach.h"
#include "nsCycleCollectionNoteChild.h"
#include "js/RootingAPI.h"

#define NS_XPCOMCYCLECOLLECTIONPARTICIPANT_IID                                 \
{                                                                              \
    0x9674489b,                                                                \
    0x1f6f,                                                                    \
    0x4550,                                                                    \
    { 0xa7, 0x30, 0xcc, 0xae, 0xdd, 0x10, 0x4c, 0xf9 }                         \
}

/**
 * Special IID to get at the base nsISupports for a class. Usually this is the
 * canonical nsISupports pointer, but in the case of tearoffs for example it is
 * the base nsISupports pointer of the tearoff. This allow the cycle collector
 * to have separate nsCycleCollectionParticipant's for tearoffs or aggregated
 * classes.
 */
#define NS_CYCLECOLLECTIONISUPPORTS_IID                                        \
{                                                                              \
    0xc61eac14,                                                                \
    0x5f7a,                                                                    \
    0x4481,                                                                    \
    { 0x96, 0x5e, 0x7e, 0xaa, 0x6e, 0xff, 0xa8, 0x5f }                         \
}

/**
 * Just holds the IID so NS_GET_IID works.
 */
class nsCycleCollectionISupports
{
public:
  NS_DECLARE_STATIC_IID_ACCESSOR(NS_CYCLECOLLECTIONISUPPORTS_IID)
};

NS_DEFINE_STATIC_IID_ACCESSOR(nsCycleCollectionISupports,
                              NS_CYCLECOLLECTIONISUPPORTS_IID)

namespace JS {
template<class T> class Heap;
} /* namespace JS */

/*
 * A struct defining pure virtual methods which are called when tracing cycle
 * collection paticipants.  The appropriate method is called depending on the
 * type of JS GC thing.
 */
struct TraceCallbacks
{
  virtual void Trace(JS::Heap<JS::Value>* aPtr, const char* aName,
                     void* aClosure) const = 0;
  virtual void Trace(JS::Heap<jsid>* aPtr, const char* aName,
                     void* aClosure) const = 0;
  virtual void Trace(JS::Heap<JSObject*>* aPtr, const char* aName,
                     void* aClosure) const = 0;
  virtual void Trace(JS::TenuredHeap<JSObject*>* aPtr, const char* aName,
                     void* aClosure) const = 0;
  virtual void Trace(JS::Heap<JSString*>* aPtr, const char* aName,
                     void* aClosure) const = 0;
  virtual void Trace(JS::Heap<JSScript*>* aPtr, const char* aName,
                     void* aClosure) const = 0;
  virtual void Trace(JS::Heap<JSFunction*>* aPtr, const char* aName,
                     void* aClosure) const = 0;
};

/*
 * An implementation of TraceCallbacks that calls a single function for all JS
 * GC thing types encountered.
 */
struct TraceCallbackFunc : public TraceCallbacks
{
  typedef void (*Func)(void* aPtr, const char* aName, void* aClosure);

  explicit TraceCallbackFunc(Func aCb) : mCallback(aCb) {}

  virtual void Trace(JS::Heap<JS::Value>* aPtr, const char* aName,
                     void* aClosure) const MOZ_OVERRIDE;
  virtual void Trace(JS::Heap<jsid>* aPtr, const char* aName,
                     void* aClosure) const MOZ_OVERRIDE;
  virtual void Trace(JS::Heap<JSObject*>* aPtr, const char* aName,
                     void* aClosure) const MOZ_OVERRIDE;
  virtual void Trace(JS::TenuredHeap<JSObject*>* aPtr, const char* aName,
                     void* aClosure) const MOZ_OVERRIDE;
  virtual void Trace(JS::Heap<JSString*>* aPtr, const char* aName,
                     void* aClosure) const MOZ_OVERRIDE;
  virtual void Trace(JS::Heap<JSScript*>* aPtr, const char* aName,
                     void* aClosure) const MOZ_OVERRIDE;
  virtual void Trace(JS::Heap<JSFunction*>* aPtr, const char* aName,
                     void* aClosure) const MOZ_OVERRIDE;

private:
  Func mCallback;
};

/**
 * Participant implementation classes
 */
class NS_NO_VTABLE nsCycleCollectionParticipant
{
public:
  MOZ_CONSTEXPR nsCycleCollectionParticipant() : mMightSkip(false) {}
  MOZ_CONSTEXPR explicit nsCycleCollectionParticipant(bool aSkip) : mMightSkip(aSkip) {}

  NS_IMETHOD Traverse(void* aPtr, nsCycleCollectionTraversalCallback& aCb) = 0;

  NS_IMETHOD_(void) Root(void* aPtr) = 0;
  NS_IMETHOD_(void) Unlink(void* aPtr) = 0;
  NS_IMETHOD_(void) Unroot(void* aPtr) = 0;

  NS_IMETHOD_(void) Trace(void* aPtr, const TraceCallbacks& aCb,
                          void* aClosure) {}

  // If CanSkip returns true, p is removed from the purple buffer during
  // a call to nsCycleCollector_forgetSkippable().
  // Note, calling CanSkip may remove objects from the purple buffer!
  // If aRemovingAllowed is true, p can be removed from the purple buffer.
  bool CanSkip(void* aPtr, bool aRemovingAllowed)
  {
    return mMightSkip ? CanSkipReal(aPtr, aRemovingAllowed) : false;
  }

  // If CanSkipInCC returns true, p is skipped when selecting roots for the
  // cycle collector graph.
  // Note, calling CanSkipInCC may remove other objects from the purple buffer!
  bool CanSkipInCC(void* aPtr)
  {
    return mMightSkip ? CanSkipInCCReal(aPtr) : false;
  }

  // If CanSkipThis returns true, p is not added to the graph.
  // This method is called during cycle collection, so don't
  // change the state of any objects!
  bool CanSkipThis(void* aPtr)
  {
    return mMightSkip ? CanSkipThisReal(aPtr) : false;
  }

  NS_IMETHOD_(void) DeleteCycleCollectable(void* aPtr) = 0;

protected:
  NS_IMETHOD_(bool) CanSkipReal(void* aPtr, bool aRemovingAllowed)
  {
    NS_ASSERTION(false, "Forgot to implement CanSkipReal?");
    return false;
  }
  NS_IMETHOD_(bool) CanSkipInCCReal(void* aPtr)
  {
    NS_ASSERTION(false, "Forgot to implement CanSkipInCCReal?");
    return false;
  }
  NS_IMETHOD_(bool) CanSkipThisReal(void* aPtr)
  {
    NS_ASSERTION(false, "Forgot to implement CanSkipThisReal?");
    return false;
  }

private:
  const bool mMightSkip;
};

class NS_NO_VTABLE nsScriptObjectTracer : public nsCycleCollectionParticipant
{
public:
  MOZ_CONSTEXPR nsScriptObjectTracer()
    : nsCycleCollectionParticipant(false)
  {
  }
  MOZ_CONSTEXPR explicit nsScriptObjectTracer(bool aSkip)
    : nsCycleCollectionParticipant(aSkip)
  {
  }

  NS_IMETHOD_(void) Trace(void* aPtr, const TraceCallbacks& aCb,
                          void* aClosure) = 0;

  static void NS_COM_GLUE NoteJSChild(void* aScriptThing, const char* aName,
                                      void* aClosure);
};

class NS_NO_VTABLE nsXPCOMCycleCollectionParticipant : public nsScriptObjectTracer
{
public:
  MOZ_CONSTEXPR nsXPCOMCycleCollectionParticipant()
    : nsScriptObjectTracer(false)
  {
  }
  MOZ_CONSTEXPR explicit nsXPCOMCycleCollectionParticipant(bool aSkip)
    : nsScriptObjectTracer(aSkip)
  {
  }

  NS_DECLARE_STATIC_IID_ACCESSOR(NS_XPCOMCYCLECOLLECTIONPARTICIPANT_IID)

  NS_IMETHOD_(void) Root(void* aPtr);
  NS_IMETHOD_(void) Unroot(void* aPtr);

  NS_IMETHOD_(void) Trace(void* aPtr, const TraceCallbacks& aCb,
                          void* aClosure);

  static bool CheckForRightISupports(nsISupports* aSupports);
};

NS_DEFINE_STATIC_IID_ACCESSOR(nsXPCOMCycleCollectionParticipant,
                              NS_XPCOMCYCLECOLLECTIONPARTICIPANT_IID)

///////////////////////////////////////////////////////////////////////////////
// Helpers for implementing a QI to nsXPCOMCycleCollectionParticipant
///////////////////////////////////////////////////////////////////////////////

#define NS_CYCLE_COLLECTION_CLASSNAME(_class)                                  \
        _class::NS_CYCLE_COLLECTION_INNERCLASS

#define NS_IMPL_QUERY_CYCLE_COLLECTION(_class)                                 \
  if ( aIID.Equals(NS_GET_IID(nsXPCOMCycleCollectionParticipant)) ) {          \
    *aInstancePtr = NS_CYCLE_COLLECTION_PARTICIPANT(_class);                   \
    return NS_OK;                                                              \
  } else

#define NS_IMPL_QUERY_CYCLE_COLLECTION_ISUPPORTS(_class)                       \
  if ( aIID.Equals(NS_GET_IID(nsCycleCollectionISupports)) ) {                 \
    *aInstancePtr = NS_CYCLE_COLLECTION_CLASSNAME(_class)::Upcast(this);       \
    return NS_OK;                                                              \
  } else

#define NS_INTERFACE_MAP_ENTRY_CYCLE_COLLECTION(_class)                        \
  NS_IMPL_QUERY_CYCLE_COLLECTION(_class)

#define NS_INTERFACE_MAP_ENTRY_CYCLE_COLLECTION_ISUPPORTS(_class)              \
  NS_IMPL_QUERY_CYCLE_COLLECTION_ISUPPORTS(_class)

#define NS_INTERFACE_MAP_ENTRIES_CYCLE_COLLECTION(_class)                      \
  NS_INTERFACE_MAP_ENTRY_CYCLE_COLLECTION(_class)                              \
  NS_INTERFACE_MAP_ENTRY_CYCLE_COLLECTION_ISUPPORTS(_class)

#define NS_INTERFACE_MAP_BEGIN_CYCLE_COLLECTION(_class)                        \
  NS_INTERFACE_MAP_BEGIN(_class)                                               \
    NS_INTERFACE_MAP_ENTRIES_CYCLE_COLLECTION(_class)

#define NS_INTERFACE_MAP_BEGIN_CYCLE_COLLECTION_INHERITED(_class)              \
  NS_INTERFACE_MAP_BEGIN(_class)                                               \
    NS_INTERFACE_MAP_ENTRY_CYCLE_COLLECTION(_class)

#define NS_INTERFACE_TABLE_TO_MAP_SEGUE_CYCLE_COLLECTION(_class)  \
  if (rv == NS_OK) return rv; \
  nsISupports* foundInterface; \
  NS_INTERFACE_MAP_ENTRIES_CYCLE_COLLECTION(_class)

#define NS_INTERFACE_TABLE_HEAD_CYCLE_COLLECTION_INHERITED(_class)            \
  NS_IMETHODIMP _class::QueryInterface(REFNSIID aIID, void** aInstancePtr)    \
  {                                                                           \
    NS_PRECONDITION(aInstancePtr, "null out param");                          \
                                                                              \
    if ( aIID.Equals(NS_GET_IID(nsXPCOMCycleCollectionParticipant)) ) {       \
      *aInstancePtr = NS_CYCLE_COLLECTION_PARTICIPANT(_class);                \
      return NS_OK;                                                           \
    }                                                                         \
    nsresult rv;

#define NS_CYCLE_COLLECTION_UPCAST(obj, clazz)                                 \
  NS_CYCLE_COLLECTION_CLASSNAME(clazz)::Upcast(obj)

#ifdef DEBUG
#define NS_CHECK_FOR_RIGHT_PARTICIPANT(_ptr) _ptr->CheckForRightParticipant()
#else
#define NS_CHECK_FOR_RIGHT_PARTICIPANT(_ptr)
#endif

// The default implementation of this class template is empty, because it
// should never be used: see the partial specializations below.
template<typename T,
         bool IsXPCOM = mozilla::IsBaseOf<nsISupports, T>::value>
struct DowncastCCParticipantImpl
{
};

// Specialization for XPCOM CC participants
template<typename T>
struct DowncastCCParticipantImpl<T, true>
{
  static T* Run(void* aPtr)
  {
    nsISupports* s = static_cast<nsISupports*>(aPtr);
    MOZ_ASSERT(NS_CYCLE_COLLECTION_CLASSNAME(T)::CheckForRightISupports(s),
               "not the nsISupports pointer we expect");
    T* rval =  NS_CYCLE_COLLECTION_CLASSNAME(T)::Downcast(s);
    NS_CHECK_FOR_RIGHT_PARTICIPANT(rval);
    return rval;
  }
};

// Specialization for native CC participants
template<typename T>
struct DowncastCCParticipantImpl<T, false>
{
  static T* Run(void* aPtr) { return static_cast<T*>(aPtr); }
};

template<typename T>
T*
DowncastCCParticipant(void* aPtr)
{
  return DowncastCCParticipantImpl<T>::Run(aPtr);
}

///////////////////////////////////////////////////////////////////////////////
// Helpers for implementing CanSkip methods
///////////////////////////////////////////////////////////////////////////////

#define NS_IMPL_CYCLE_COLLECTION_CAN_SKIP_BEGIN(_class)                        \
  NS_IMETHODIMP_(bool)                                                         \
  NS_CYCLE_COLLECTION_CLASSNAME(_class)::CanSkipReal(void *p,                  \
                                                     bool aRemovingAllowed)    \
  {                                                                            \
    _class *tmp = DowncastCCParticipant<_class >(p);

#define NS_IMPL_CYCLE_COLLECTION_CAN_SKIP_END                                  \
    (void)tmp;                                                                 \
    return false;                                                              \
  }

#define NS_IMPL_CYCLE_COLLECTION_CAN_SKIP_IN_CC_BEGIN(_class)                  \
  NS_IMETHODIMP_(bool)                                                         \
  NS_CYCLE_COLLECTION_CLASSNAME(_class)::CanSkipInCCReal(void *p)              \
  {                                                                            \
    _class *tmp = DowncastCCParticipant<_class >(p);

#define NS_IMPL_CYCLE_COLLECTION_CAN_SKIP_IN_CC_END                            \
    (void)tmp;                                                                 \
    return false;                                                              \
  }

#define NS_IMPL_CYCLE_COLLECTION_CAN_SKIP_THIS_BEGIN(_class)                   \
  NS_IMETHODIMP_(bool)                                                         \
  NS_CYCLE_COLLECTION_CLASSNAME(_class)::CanSkipThisReal(void *p)              \
  {                                                                            \
    _class *tmp = DowncastCCParticipant<_class >(p);

#define NS_IMPL_CYCLE_COLLECTION_CAN_SKIP_THIS_END                             \
    (void)tmp;                                                                 \
    return false;                                                              \
  }

///////////////////////////////////////////////////////////////////////////////
// Helpers for implementing nsCycleCollectionParticipant::Unlink
//
// You need to use NS_IMPL_CYCLE_COLLECTION_UNLINK_BEGIN_INHERITED if you want
// the base class Unlink version to be called before your own implementation.
// You can use NS_IMPL_CYCLE_COLLECTION_UNLINK_END_INHERITED if you want the
// base class Unlink to get called after your own implementation.  You should
// never use them together.
///////////////////////////////////////////////////////////////////////////////

#define NS_IMPL_CYCLE_COLLECTION_UNLINK_BEGIN(_class)                          \
  NS_IMETHODIMP_(void)                                                         \
  NS_CYCLE_COLLECTION_CLASSNAME(_class)::Unlink(void *p)                       \
  {                                                                            \
    _class *tmp = DowncastCCParticipant<_class >(p);

#define NS_IMPL_CYCLE_COLLECTION_UNLINK_BEGIN_INHERITED(_class, _base_class)   \
  NS_IMPL_CYCLE_COLLECTION_UNLINK_BEGIN(_class)                                \
    nsISupports *s = static_cast<nsISupports*>(p);                             \
    NS_CYCLE_COLLECTION_CLASSNAME(_base_class)::Unlink(s);

#define NS_IMPL_CYCLE_COLLECTION_UNLINK_HELPER(_field)                        \
  ImplCycleCollectionUnlink(tmp->_field);

#define NS_IMPL_CYCLE_COLLECTION_UNLINK(...)                                   \
  MOZ_STATIC_ASSERT_VALID_ARG_COUNT(__VA_ARGS__);                              \
  MOZ_FOR_EACH(NS_IMPL_CYCLE_COLLECTION_UNLINK_HELPER, (), (__VA_ARGS__))

#define NS_IMPL_CYCLE_COLLECTION_UNLINK_END                                    \
    (void)tmp;                                                                 \
  }

#define NS_IMPL_CYCLE_COLLECTION_UNLINK_END_INHERITED(_base_class)             \
    nsISupports *s = static_cast<nsISupports*>(p);                             \
    NS_CYCLE_COLLECTION_CLASSNAME(_base_class)::Unlink(s);                     \
    (void)tmp;                                                                 \
  }

#define NS_IMPL_CYCLE_COLLECTION_UNLINK_0(_class)                              \
  NS_IMPL_CYCLE_COLLECTION_UNLINK_BEGIN(_class)                                \
  NS_IMPL_CYCLE_COLLECTION_UNLINK_END


///////////////////////////////////////////////////////////////////////////////
// Helpers for implementing nsCycleCollectionParticipant::Traverse
///////////////////////////////////////////////////////////////////////////////

#define NS_IMPL_CYCLE_COLLECTION_DESCRIBE(_class, _refcnt)                     \
    cb.DescribeRefCountedNode(_refcnt, #_class);

#define NS_IMPL_CYCLE_COLLECTION_TRAVERSE_BEGIN_INTERNAL(_class)               \
  NS_IMETHODIMP                                                                \
  NS_CYCLE_COLLECTION_CLASSNAME(_class)::Traverse                              \
                         (void *p, nsCycleCollectionTraversalCallback &cb)     \
  {                                                                            \
    _class *tmp = DowncastCCParticipant<_class >(p);

#define NS_IMPL_CYCLE_COLLECTION_TRAVERSE_BEGIN(_class)                        \
  NS_IMPL_CYCLE_COLLECTION_TRAVERSE_BEGIN_INTERNAL(_class)                     \
  NS_IMPL_CYCLE_COLLECTION_DESCRIBE(_class, tmp->mRefCnt.get())

// Base class' CC participant should return NS_SUCCESS_INTERRUPTED_TRAVERSE
// from Traverse if it wants derived classes to not traverse anything from
// their CC participant.

#define NS_IMPL_CYCLE_COLLECTION_TRAVERSE_BEGIN_INHERITED(_class, _base_class) \
  NS_IMPL_CYCLE_COLLECTION_TRAVERSE_BEGIN_INTERNAL(_class)                     \
    nsISupports *s = static_cast<nsISupports*>(p);                             \
    if (NS_CYCLE_COLLECTION_CLASSNAME(_base_class)::Traverse(s, cb)            \
        == NS_SUCCESS_INTERRUPTED_TRAVERSE) {                                  \
      return NS_SUCCESS_INTERRUPTED_TRAVERSE;                                  \
    }

#define NS_IMPL_CYCLE_COLLECTION_TRAVERSE_HELPER(_field)                       \
  ImplCycleCollectionTraverse(cb, tmp->_field, #_field, 0);

#define NS_IMPL_CYCLE_COLLECTION_TRAVERSE(...)                                 \
  MOZ_STATIC_ASSERT_VALID_ARG_COUNT(__VA_ARGS__);                              \
  MOZ_FOR_EACH(NS_IMPL_CYCLE_COLLECTION_TRAVERSE_HELPER, (), (__VA_ARGS__))

#define NS_IMPL_CYCLE_COLLECTION_TRAVERSE_RAWPTR(_field)                       \
  CycleCollectionNoteChild(cb, tmp->_field, #_field);

#define NS_IMPL_CYCLE_COLLECTION_TRAVERSE_SCRIPT_OBJECTS                       \
  {                                                                            \
  TraceCallbackFunc noteJsChild(&nsScriptObjectTracer::NoteJSChild);           \
  Trace(p, noteJsChild, &cb);                                                  \
  }

#define NS_IMPL_CYCLE_COLLECTION_TRAVERSE_END                                  \
    (void)tmp;                                                                 \
    return NS_OK;                                                              \
  }

///////////////////////////////////////////////////////////////////////////////
// Helpers for implementing nsScriptObjectTracer::Trace
///////////////////////////////////////////////////////////////////////////////

#define NS_IMPL_CYCLE_COLLECTION_TRACE_BEGIN(_class)                                 \
  void                                                                               \
  NS_CYCLE_COLLECTION_CLASSNAME(_class)::Trace(void *p,                              \
                                               const TraceCallbacks &aCallbacks,     \
                                               void *aClosure)                       \
  {                                                                                  \
    _class *tmp = DowncastCCParticipant<_class >(p);

#define NS_IMPL_CYCLE_COLLECTION_TRACE_BEGIN_INHERITED(_class, _base_class)    \
  NS_IMPL_CYCLE_COLLECTION_TRACE_BEGIN(_class)                                 \
    nsISupports *s = static_cast<nsISupports*>(p);                             \
    NS_CYCLE_COLLECTION_CLASSNAME(_base_class)::Trace(s, aCallbacks, aClosure);

#define NS_IMPL_CYCLE_COLLECTION_TRACE_JS_MEMBER_CALLBACK(_field)              \
  if (tmp->_field)                                                             \
    aCallbacks.Trace(&tmp->_field, #_field, aClosure);

#define NS_IMPL_CYCLE_COLLECTION_TRACE_JSVAL_MEMBER_CALLBACK(_field)           \
  aCallbacks.Trace(&tmp->_field, #_field, aClosure);

// NB: The (void)tmp; hack in the TRACE_END macro exists to support
// implementations that don't need to do anything in their Trace method.
// Without this hack, some compilers warn about the unused tmp local.
#define NS_IMPL_CYCLE_COLLECTION_TRACE_END                                     \
      (void)tmp;                                                               \
  }

///////////////////////////////////////////////////////////////////////////////
// Helpers for implementing a concrete nsCycleCollectionParticipant
///////////////////////////////////////////////////////////////////////////////

// If a class defines a participant, then QIing an instance of that class to
// nsXPCOMCycleCollectionParticipant should produce that participant.
#ifdef DEBUG
#define NS_CHECK_FOR_RIGHT_PARTICIPANT_IMPL(_class)                            \
    virtual void CheckForRightParticipant()                                    \
    {                                                                          \
      nsXPCOMCycleCollectionParticipant *p;                                    \
      CallQueryInterface(this, &p);                                            \
      MOZ_ASSERT(p == &NS_CYCLE_COLLECTION_INNERNAME,                          \
                 #_class " should QI to its own CC participant");              \
    }
#else
#define NS_CHECK_FOR_RIGHT_PARTICIPANT_IMPL(_class)
#endif

#define NS_DECL_CYCLE_COLLECTION_CLASS_BODY_NO_UNLINK(_class, _base)           \
public:                                                                        \
  NS_IMETHOD Traverse(void *p, nsCycleCollectionTraversalCallback &cb);        \
  NS_IMETHOD_(void) DeleteCycleCollectable(void *p)                            \
  {                                                                            \
    DowncastCCParticipant<_class>(p)->DeleteCycleCollectable();                \
  }                                                                            \
  static _class* Downcast(nsISupports* s)                                      \
  {                                                                            \
    return static_cast<_class*>(static_cast<_base*>(s));                       \
  }                                                                            \
  static nsISupports* Upcast(_class *p)                                        \
  {                                                                            \
    return NS_ISUPPORTS_CAST(_base*, p);                                       \
  }                                                                            \
  template<typename T>                                                         \
  friend nsISupports*                                                          \
  ToSupports(T* p, NS_CYCLE_COLLECTION_INNERCLASS* dummy);

#define NS_DECL_CYCLE_COLLECTION_CLASS_BODY(_class, _base)                     \
  NS_DECL_CYCLE_COLLECTION_CLASS_BODY_NO_UNLINK(_class, _base)                 \
  NS_IMETHOD_(void) Unlink(void *p);

#define NS_PARTICIPANT_AS(type, participant)                                   \
  const_cast<type*>(reinterpret_cast<const type*>(participant))

#define NS_IMPL_GET_XPCOM_CYCLE_COLLECTION_PARTICIPANT(_class)                 \
  static MOZ_CONSTEXPR nsXPCOMCycleCollectionParticipant* GetParticipant()     \
  {                                                                            \
    return &_class::NS_CYCLE_COLLECTION_INNERNAME;                             \
  }

/**
 * We use this macro to force that classes that inherit from a ccable class and
 * declare their own participant declare themselves as inherited cc classes.
 * To avoid possibly unnecessary vtables we only do this checking in debug
 * builds.
 */
#ifdef DEBUG
#define NOT_INHERITED_CANT_OVERRIDE virtual void BaseCycleCollectable() MOZ_FINAL {}
#else
#define NOT_INHERITED_CANT_OVERRIDE
#endif

#define NS_DECL_CYCLE_COLLECTION_CLASS_AMBIGUOUS(_class, _base)                \
class NS_CYCLE_COLLECTION_INNERCLASS                                           \
 : public nsXPCOMCycleCollectionParticipant                                    \
{                                                                              \
  NS_DECL_CYCLE_COLLECTION_CLASS_BODY(_class, _base)                           \
  NS_IMPL_GET_XPCOM_CYCLE_COLLECTION_PARTICIPANT(_class)                       \
};                                                                             \
NS_CHECK_FOR_RIGHT_PARTICIPANT_IMPL(_class)                                    \
static NS_CYCLE_COLLECTION_INNERCLASS NS_CYCLE_COLLECTION_INNERNAME;           \
  NOT_INHERITED_CANT_OVERRIDE

#define NS_DECL_CYCLE_COLLECTION_CLASS(_class)                                 \
  NS_DECL_CYCLE_COLLECTION_CLASS_AMBIGUOUS(_class, _class)

// Cycle collector helper for ambiguous classes that can sometimes be skipped.
#define NS_DECL_CYCLE_COLLECTION_SKIPPABLE_CLASS_AMBIGUOUS(_class, _base)        \
class NS_CYCLE_COLLECTION_INNERCLASS                                             \
 : public nsXPCOMCycleCollectionParticipant                                      \
{                                                                                \
public:                                                                          \
  MOZ_CONSTEXPR NS_CYCLE_COLLECTION_INNERCLASS ()                                \
  : nsXPCOMCycleCollectionParticipant(true) {}                                   \
private:                                                                         \
  NS_DECL_CYCLE_COLLECTION_CLASS_BODY(_class, _base)                             \
  NS_IMETHOD_(bool) CanSkipReal(void *p, bool aRemovingAllowed);                 \
  NS_IMETHOD_(bool) CanSkipInCCReal(void *p);                                    \
  NS_IMETHOD_(bool) CanSkipThisReal(void *p);                                    \
  NS_IMPL_GET_XPCOM_CYCLE_COLLECTION_PARTICIPANT(_class)                         \
};                                                                               \
NS_CHECK_FOR_RIGHT_PARTICIPANT_IMPL(_class)                                      \
static NS_CYCLE_COLLECTION_INNERCLASS NS_CYCLE_COLLECTION_INNERNAME;             \
NOT_INHERITED_CANT_OVERRIDE

#define NS_DECL_CYCLE_COLLECTION_SKIPPABLE_CLASS(_class)                       \
        NS_DECL_CYCLE_COLLECTION_SKIPPABLE_CLASS_AMBIGUOUS(_class, _class)

#define NS_DECL_CYCLE_COLLECTION_SCRIPT_HOLDER_CLASS_AMBIGUOUS(_class, _base)          \
class NS_CYCLE_COLLECTION_INNERCLASS                                                   \
 : public nsXPCOMCycleCollectionParticipant                                            \
{                                                                                      \
  NS_DECL_CYCLE_COLLECTION_CLASS_BODY(_class, _base)                                   \
  NS_IMETHOD_(void) Trace(void *p, const TraceCallbacks &cb, void *closure);           \
  NS_IMPL_GET_XPCOM_CYCLE_COLLECTION_PARTICIPANT(_class)                               \
};                                                                                     \
NS_CHECK_FOR_RIGHT_PARTICIPANT_IMPL(_class)                                            \
static NS_CYCLE_COLLECTION_INNERCLASS NS_CYCLE_COLLECTION_INNERNAME; \
NOT_INHERITED_CANT_OVERRIDE

#define NS_DECL_CYCLE_COLLECTION_SKIPPABLE_SCRIPT_HOLDER_CLASS_AMBIGUOUS(_class, _base)   \
class NS_CYCLE_COLLECTION_INNERCLASS                                                      \
 : public nsXPCOMCycleCollectionParticipant                                               \
{                                                                                         \
public:                                                                                   \
  MOZ_CONSTEXPR NS_CYCLE_COLLECTION_INNERCLASS ()                                         \
  : nsXPCOMCycleCollectionParticipant(true) {}                                            \
private:                                                                                  \
  NS_DECL_CYCLE_COLLECTION_CLASS_BODY(_class, _base)                                      \
  NS_IMETHOD_(void) Trace(void *p, const TraceCallbacks &cb, void *closure);              \
  NS_IMETHOD_(bool) CanSkipReal(void *p, bool aRemovingAllowed);                          \
  NS_IMETHOD_(bool) CanSkipInCCReal(void *p);                                             \
  NS_IMETHOD_(bool) CanSkipThisReal(void *p);                                             \
  NS_IMPL_GET_XPCOM_CYCLE_COLLECTION_PARTICIPANT(_class)                                  \
};                                                                                        \
NS_CHECK_FOR_RIGHT_PARTICIPANT_IMPL(_class)                                               \
static NS_CYCLE_COLLECTION_INNERCLASS NS_CYCLE_COLLECTION_INNERNAME; \
NOT_INHERITED_CANT_OVERRIDE

#define NS_DECL_CYCLE_COLLECTION_SKIPPABLE_SCRIPT_HOLDER_CLASS(_class)  \
  NS_DECL_CYCLE_COLLECTION_SKIPPABLE_SCRIPT_HOLDER_CLASS_AMBIGUOUS(_class, _class)

#define NS_DECL_CYCLE_COLLECTION_SKIPPABLE_SCRIPT_HOLDER_CLASS_INHERITED(_class,       \
                                                                         _base_class)  \
class NS_CYCLE_COLLECTION_INNERCLASS                                                   \
 : public NS_CYCLE_COLLECTION_CLASSNAME(_base_class)                                   \
{                                                                                      \
  NS_DECL_CYCLE_COLLECTION_CLASS_INHERITED_BODY(_class, _base_class)                   \
  NS_IMETHOD_(void) Trace(void *p, const TraceCallbacks &cb, void *closure);           \
  NS_IMETHOD_(bool) CanSkipReal(void *p, bool aRemovingAllowed);                       \
  NS_IMETHOD_(bool) CanSkipInCCReal(void *p);                                          \
  NS_IMETHOD_(bool) CanSkipThisReal(void *p);                                          \
  NS_IMPL_GET_XPCOM_CYCLE_COLLECTION_PARTICIPANT(_class)                               \
}; \
NS_CHECK_FOR_RIGHT_PARTICIPANT_IMPL(_class)  \
static NS_CYCLE_COLLECTION_INNERCLASS NS_CYCLE_COLLECTION_INNERNAME;

#define NS_DECL_CYCLE_COLLECTION_SCRIPT_HOLDER_CLASS(_class)  \
  NS_DECL_CYCLE_COLLECTION_SCRIPT_HOLDER_CLASS_AMBIGUOUS(_class, _class)

#define NS_DECL_CYCLE_COLLECTION_CLASS_INHERITED_BODY_NO_UNLINK(_class,        \
                                                                _base_class)   \
public:                                                                        \
  NS_IMETHOD Traverse(void *p, nsCycleCollectionTraversalCallback &cb);        \
  static _class* Downcast(nsISupports* s)                                      \
  {                                                                            \
    return static_cast<_class*>(static_cast<_base_class*>(                     \
      NS_CYCLE_COLLECTION_CLASSNAME(_base_class)::Downcast(s)));               \
  }

#define NS_DECL_CYCLE_COLLECTION_CLASS_INHERITED_BODY(_class, _base_class)     \
  NS_DECL_CYCLE_COLLECTION_CLASS_INHERITED_BODY_NO_UNLINK(_class, _base_class) \
  NS_IMETHOD_(void) Unlink(void *p);

#define NS_DECL_CYCLE_COLLECTION_CLASS_INHERITED(_class, _base_class)          \
class NS_CYCLE_COLLECTION_INNERCLASS                                           \
 : public NS_CYCLE_COLLECTION_CLASSNAME(_base_class)                           \
{                                                                              \
public:                                                                        \
  NS_DECL_CYCLE_COLLECTION_CLASS_INHERITED_BODY(_class, _base_class)           \
  NS_IMPL_GET_XPCOM_CYCLE_COLLECTION_PARTICIPANT(_class)                       \
};                                                                             \
NS_CHECK_FOR_RIGHT_PARTICIPANT_IMPL(_class)                                    \
static NS_CYCLE_COLLECTION_INNERCLASS NS_CYCLE_COLLECTION_INNERNAME;

#define NS_DECL_CYCLE_COLLECTION_CLASS_INHERITED_NO_UNLINK(_class,             \
                                                           _base_class)        \
class NS_CYCLE_COLLECTION_INNERCLASS                                           \
 : public NS_CYCLE_COLLECTION_CLASSNAME(_base_class)                           \
{                                                                              \
public:                                                                        \
  NS_DECL_CYCLE_COLLECTION_CLASS_INHERITED_BODY_NO_UNLINK(_class, _base_class) \
  NS_IMPL_GET_XPCOM_CYCLE_COLLECTION_PARTICIPANT(_class)                       \
};                                                                             \
NS_CHECK_FOR_RIGHT_PARTICIPANT_IMPL(_class)                                    \
static NS_CYCLE_COLLECTION_INNERCLASS NS_CYCLE_COLLECTION_INNERNAME;

#define NS_DECL_CYCLE_COLLECTION_SCRIPT_HOLDER_CLASS_INHERITED(_class,                 \
                                                               _base_class)            \
class NS_CYCLE_COLLECTION_INNERCLASS                                                   \
 : public NS_CYCLE_COLLECTION_CLASSNAME(_base_class)                                   \
{                                                                                      \
  NS_DECL_CYCLE_COLLECTION_CLASS_INHERITED_BODY(_class, _base_class)                   \
  NS_IMETHOD_(void) Trace(void *p, const TraceCallbacks &cb, void *closure);           \
  NS_IMPL_GET_XPCOM_CYCLE_COLLECTION_PARTICIPANT(_class)                               \
};                                                                                     \
NS_CHECK_FOR_RIGHT_PARTICIPANT_IMPL(_class)                                            \
static NS_CYCLE_COLLECTION_INNERCLASS NS_CYCLE_COLLECTION_INNERNAME;

// Cycle collector participant declarations.

#define NS_DECL_CYCLE_COLLECTION_NATIVE_CLASS_BODY(_class)                     \
  public:                                                                      \
    NS_IMETHOD_(void) Root(void *n);                                           \
    NS_IMETHOD_(void) Unlink(void *n);                                         \
    NS_IMETHOD_(void) Unroot(void *n);                                         \
    NS_IMETHOD Traverse(void *n, nsCycleCollectionTraversalCallback &cb);      \
    NS_IMETHOD_(void) DeleteCycleCollectable(void *n)                          \
    {                                                                          \
      DowncastCCParticipant<_class>(n)->DeleteCycleCollectable();              \
    }                                                                          \
    static _class* Downcast(void* s)                                           \
    {                                                                          \
      return DowncastCCParticipant<_class>(s);                                 \
    }                                                                          \
    static void* Upcast(_class *p)                                             \
    {                                                                          \
      return static_cast<void*>(p);                                            \
    }

#define NS_DECL_CYCLE_COLLECTION_NATIVE_CLASS(_class)                          \
  void DeleteCycleCollectable(void)                                            \
  {                                                                            \
    delete this;                                                               \
  }                                                                            \
  class NS_CYCLE_COLLECTION_INNERCLASS                                         \
   : public nsCycleCollectionParticipant                                       \
  {                                                                            \
    NS_DECL_CYCLE_COLLECTION_NATIVE_CLASS_BODY(_class)                         \
    static MOZ_CONSTEXPR nsCycleCollectionParticipant* GetParticipant()        \
    {                                                                          \
      return &_class::NS_CYCLE_COLLECTION_INNERNAME;                           \
    }                                                                          \
  };                                                                           \
  static NS_CYCLE_COLLECTION_INNERCLASS NS_CYCLE_COLLECTION_INNERNAME;

#define NS_DECL_CYCLE_COLLECTION_SKIPPABLE_NATIVE_CLASS_WITH_CUSTOM_DELETE(_class) \
class NS_CYCLE_COLLECTION_INNERCLASS                                           \
 : public nsCycleCollectionParticipant                                         \
{                                                                              \
public:                                                                        \
  MOZ_CONSTEXPR NS_CYCLE_COLLECTION_INNERCLASS ()                              \
  : nsCycleCollectionParticipant(true) {}                                      \
private:                                                                       \
  NS_DECL_CYCLE_COLLECTION_NATIVE_CLASS_BODY(_class)                           \
  NS_IMETHOD_(bool) CanSkipReal(void *p, bool aRemovingAllowed);               \
  NS_IMETHOD_(bool) CanSkipInCCReal(void *p);                                  \
  NS_IMETHOD_(bool) CanSkipThisReal(void *p);                                  \
  static nsCycleCollectionParticipant* GetParticipant()                        \
  {                                                                            \
    return &_class::NS_CYCLE_COLLECTION_INNERNAME;                             \
  }                                                                            \
};                                                                             \
static NS_CYCLE_COLLECTION_INNERCLASS NS_CYCLE_COLLECTION_INNERNAME;

#define NS_DECL_CYCLE_COLLECTION_SCRIPT_HOLDER_NATIVE_CLASS(_class)            \
  void DeleteCycleCollectable(void)                                            \
  {                                                                            \
    delete this;                                                               \
  }                                                                            \
  class NS_CYCLE_COLLECTION_INNERCLASS                                         \
   : public nsScriptObjectTracer                                               \
  {                                                                            \
    NS_DECL_CYCLE_COLLECTION_NATIVE_CLASS_BODY(_class)                         \
    NS_IMETHOD_(void) Trace(void *p, const TraceCallbacks &cb, void *closure); \
    static MOZ_CONSTEXPR nsScriptObjectTracer* GetParticipant()                \
    {                                                                          \
      return &_class::NS_CYCLE_COLLECTION_INNERNAME;                           \
    }                                                                          \
  };                                                                           \
  static NS_CYCLE_COLLECTION_INNERCLASS NS_CYCLE_COLLECTION_INNERNAME;

#define NS_IMPL_CYCLE_COLLECTION_ROOT_NATIVE(_class, _root_function)           \
  NS_IMETHODIMP_(void)                                                         \
  NS_CYCLE_COLLECTION_CLASSNAME(_class)::Root(void *p)                         \
  {                                                                            \
    _class *tmp = static_cast<_class*>(p);                                     \
    tmp->_root_function();                                                     \
  }

#define NS_IMPL_CYCLE_COLLECTION_UNROOT_NATIVE(_class, _unroot_function)       \
  NS_IMETHODIMP_(void)                                                         \
  NS_CYCLE_COLLECTION_CLASSNAME(_class)::Unroot(void *p)                       \
  {                                                                            \
    _class *tmp = static_cast<_class*>(p);                                     \
    tmp->_unroot_function();                                                   \
  }

#define NS_IMPL_CYCLE_COLLECTION_CLASS(_class) \
 _class::NS_CYCLE_COLLECTION_INNERCLASS _class::NS_CYCLE_COLLECTION_INNERNAME;

// NB: This is not something you usually want to use.  It is here to allow
// adding things to the CC graph to help debugging via CC logs, but it does not
// traverse or unlink anything, so it is useless for anything else.
#define NS_IMPL_CYCLE_COLLECTION_0(_class)                                     \
  NS_IMPL_CYCLE_COLLECTION_CLASS(_class)                                       \
  NS_IMPL_CYCLE_COLLECTION_UNLINK_BEGIN(_class)                                \
  NS_IMPL_CYCLE_COLLECTION_UNLINK_END                                          \
  NS_IMPL_CYCLE_COLLECTION_TRAVERSE_BEGIN(_class)                              \
  NS_IMPL_CYCLE_COLLECTION_TRAVERSE_END

#define NS_IMPL_CYCLE_COLLECTION(_class, ...)                                  \
  NS_IMPL_CYCLE_COLLECTION_CLASS(_class)                                       \
  NS_IMPL_CYCLE_COLLECTION_UNLINK_BEGIN(_class)                                \
  NS_IMPL_CYCLE_COLLECTION_UNLINK(__VA_ARGS__)                                 \
  NS_IMPL_CYCLE_COLLECTION_UNLINK_END                                          \
  NS_IMPL_CYCLE_COLLECTION_TRAVERSE_BEGIN(_class)                              \
  NS_IMPL_CYCLE_COLLECTION_TRAVERSE(__VA_ARGS__)                               \
  NS_IMPL_CYCLE_COLLECTION_TRAVERSE_END

#define NS_IMPL_CYCLE_COLLECTION_INHERITED(_class, _base, ...)                 \
  NS_IMPL_CYCLE_COLLECTION_CLASS(_class)                                       \
  NS_IMPL_CYCLE_COLLECTION_UNLINK_BEGIN_INHERITED(_class, _base)               \
  NS_IMPL_CYCLE_COLLECTION_UNLINK(__VA_ARGS__)                                 \
  NS_IMPL_CYCLE_COLLECTION_UNLINK_END                                          \
  NS_IMPL_CYCLE_COLLECTION_TRAVERSE_BEGIN_INHERITED(_class, _base)             \
  NS_IMPL_CYCLE_COLLECTION_TRAVERSE(__VA_ARGS__)                               \
  NS_IMPL_CYCLE_COLLECTION_TRAVERSE_END

#define NS_CYCLE_COLLECTION_NOTE_EDGE_NAME CycleCollectionNoteEdgeName

#endif // nsCycleCollectionParticipant_h__
