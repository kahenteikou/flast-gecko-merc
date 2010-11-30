/* -*- Mode: c++; c-basic-offset: 4; tab-width: 40; indent-tabs-mode: nil -*- */
/* vim: set ts=40 sw=4 et tw=99: */
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
 * The Original Code is the Mozilla SpiderMonkey bytecode analysis
 *
 * The Initial Developer of the Original Code is
 *   Mozilla Foundation
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
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

/* Definitions for javascript analysis. */

#ifndef jsanalyze_h___
#define jsanalyze_h___

#include "jsarena.h"
#include "jscntxt.h"
#include "jsinfer.h"
#include "jsscript.h"

struct JSScript;

namespace js {
namespace analyze {

class Script;

/* Information about a bytecode instruction. */
struct Bytecode
{
    friend class Script;

    /* Whether there are any incoming jumps to this instruction. */
    bool jumpTarget : 1;    

    /* Whether there is fallthrough to this instruction from a non-branching instruction. */
    bool fallthrough : 1;

    /* Whether this instruction has been analyzed to get its output defines and stack. */
    bool analyzed : 1;

    /* Whether this is a catch/finally entry point. */
    bool exceptionEntry : 1;

    /* Whether this is in a try block. */
    bool inTryBlock : 1;

    /* Whether this is a method JIT safe point. */
    bool safePoint : 1;

    /*
     * For type inference, whether this bytecode needs to have its effects monitored dynamically.
     * This is limited to property/name sets and calls.
     */
    bool monitorNeeded : 1;

    /* Stack depth before this opcode. */
    uint32 stackDepth;

    /*
     * The set of locals defined at this point.  This does not include locals which
     * were unconditionally defined at an earlier point in the script.
     */
    uint32 defineCount;
    uint32 *defineArray;

    Bytecode(Script *script, unsigned offset)
    {
        PodZero(this);

#ifdef JS_TYPE_INFERENCE
        this->script = script;
        this->offset = offset;
#endif
    }

  private:
    bool mergeDefines(JSContext *cx, Script *script, bool initial,
                      uint32 newDepth, types::TypeStack *newStack,
                      uint32 *newArray, uint32 newCount);

    /* Whether a local variable is in the define set at this bytecode. */
    bool isDefined(uint32 slot)
    {
        JS_ASSERT(analyzed);
        for (unsigned ind = 0; ind < defineCount; ind++) {
            if (defineArray[ind] == slot)
                return true;
        }
        return false;
    }

#ifdef JS_TYPE_INFERENCE
  public:

    Script *script;
    unsigned offset;

    /* Contents of the stack when this instruction is executed. */
    types::TypeStack *inStack;

    /* Array of stack nodes pushed by this instruction. */
    types::TypeStack *pushedArray;

    /* Any new Array or Object created at this bytecode. */
    types::TypeObject *initArray;
    types::TypeObject *initObject;

    /*
     * For inc/dec operations, whether the operation dynamically overflowed to double.
     * Should one of these overflow, we reanalyze the affected bytecode.
     */
    bool hasIncDecOverflow : 1;

    /* Pool which constraints on this instruction should use. */
    inline JSArenaPool &pool();

    /* Get the type set for the Nth value popped by this instruction. */
    inline types::TypeSet *popped(unsigned num);

    /* Get the type set for the Nth value pushed by this instruction. */
    inline types::TypeSet *pushed(unsigned num);

    /* Mark a trivially determined fixed type for a value pushed by this instruction. */
    inline void setFixed(JSContext *cx, unsigned num, types::jstype type);

    /*
     * Get the new object at this bytecode. propagation will be performed from
     * either Object or Array, per isArray.
     */
    inline types::TypeObject* getInitObject(JSContext *cx, bool isArray);

#ifdef DEBUG
    void print(JSContext *cx);
#endif

#endif /* JS_TYPE_INFERENCE */

};

/* Information about a script. */
class Script
{
    friend struct Bytecode;

    JSScript *script;
    Bytecode **codeArray;

    /* Maximum number of locals to consider for a script. */
    static const unsigned LOCAL_LIMIT = 50;

    /* Offsets at which each local becomes unconditionally defined, or a value below. */
    uint32 *locals;

    static const uint32 LOCAL_USE_BEFORE_DEF = uint32(-1);
    static const uint32 LOCAL_CONDITIONALLY_DEFINED = uint32(-2);

    bool outOfMemory;
    bool hadFailure;
    bool usesRval;
    bool usesScope;

  public:
    /* Pool for allocating analysis structures which will not outlive this script. */
    JSArenaPool pool;

    void init(JSScript *script);
    void analyze(JSContext *cx);
    void destroy();

    /*
     * For analysis scripts allocated on the stack.  Scripts don't have constructors,
     * and must be zeroed out before being used.
     */
    ~Script() { destroy(); }

    /* Whether we ran out of memory during analysis. */
    bool OOM() { return outOfMemory; }

    /* Whether the script was analyzed successfully. */
    bool failed() { return hadFailure; }

    /* Whether there are POPV/SETRVAL bytecodes which can write to the frame's rval. */
    bool usesReturnValue() const { return usesRval; }

    /* Whether there are NAME bytecodes which can access the frame's scope chain. */
    bool usesScopeChain() const { return usesScope; }

    /* Whether the script has been analyzed. */
    bool hasAnalyzed() const { return !!codeArray; }

    /* Script/function being analyzed. */
    JSScript *getScript() const { return script; }

    /* Accessors for bytecode information. */

    Bytecode& getCode(uint32 offset) {
        JS_ASSERT(offset < script->length);
        JS_ASSERT(codeArray[offset]);
        return *codeArray[offset];
    }
    Bytecode& getCode(const jsbytecode *pc) { return getCode(pc - script->code); }

    Bytecode* maybeCode(uint32 offset) {
        JS_ASSERT(offset < script->length);
        return codeArray[offset];
    }
    Bytecode* maybeCode(const jsbytecode *pc) { return maybeCode(pc - script->code); }

    bool jumpTarget(uint32 offset) {
        JS_ASSERT(offset < script->length);
        return codeArray[offset] && codeArray[offset]->jumpTarget;
    }
    bool jumpTarget(const jsbytecode *pc) { return jumpTarget(pc - script->code); }

    bool monitored(uint32 offset) { return getCode(offset).monitorNeeded; }
    bool monitored(const jsbytecode *pc) { return getCode(pc).monitorNeeded; }

    /* Accessors for local variable information. */

    unsigned localCount() {
        return (script->nfixed >= LOCAL_LIMIT) ? LOCAL_LIMIT : script->nfixed;
    }

    bool localHasUseBeforeDef(uint32 local) {
        JS_ASSERT(!failed());
        return local >= localCount() || locals[local] == LOCAL_USE_BEFORE_DEF;
    }

    /* These return true for variables that may have a use before def. */
    bool localDefined(uint32 local, uint32 offset) {
        return localHasUseBeforeDef(local) || (locals[local] <= offset) ||
            getCode(offset).isDefined(local);
    }
    bool localDefined(uint32 local, jsbytecode *pc) {
        return localDefined(local, pc - script->code);
    }

    bool argEscapes(unsigned arg)
    {
        for (unsigned i = 0; i < script->nClosedArgs; i++) {
            if (arg == script->getClosedArg(i))
                return true;
        }
        return false;
    }

    bool localEscapes(unsigned local)
    {
        if (local >= localCount())
            return true;
        for (unsigned i = 0; i < script->nClosedVars; i++) {
            if (local == script->getClosedVar(i))
                return true;
        }
        return false;
    }

  private:
    void setOOM(JSContext *cx) {
        if (!outOfMemory)
            js_ReportOutOfMemory(cx);
        outOfMemory = true;
        hadFailure = true;
    }

    inline bool addJump(JSContext *cx, unsigned offset,
                        unsigned *currentOffset, unsigned *forwardJump,
                        unsigned stackDepth, types::TypeStack *stack,
                        uint32 *defineArray, unsigned defineCount);

    inline void setLocal(uint32 local, uint32 offset);

#ifdef JS_TYPE_INFERENCE
  public:

    /* Unique identifier within the compartment. */
    unsigned id;

    /* Function this script is the body for, if there is one. */
    JSFunction *fun;

    /* List of objects associated with this script. */
    types::TypeObject *objects;

    /*
     * Location where the definition of this script occurs, representing any
     * nesting for scope lookups.  NULL for global scripts.
     */
    JSScript *parent;
    const jsbytecode *parentpc;

    /*
     * Variables defined by this script.  This includes local variables defined
     * with 'var' or 'let' and formal arguments.
     */
    types::Variable **variableSet;
    unsigned variableCount;

    /* Types of the 'this' variable in this script. */
    types::TypeSet thisTypes;

    /* Array of local variable names, computed by js_GetLocalNameArray. */
    jsuword *localNames;

    void setFunction(JSContext *cx, JSFunction *fun);

    /* Whether this is eval code. */
    bool isEval() { return parent && !fun; }

    /* Whether this is global code, including from a global-scope eval(). */
    bool isGlobal() { return !parent || (!fun && !parent->analysis->parent); }

    unsigned argCount() { return fun ? fun->nargs : 0; }
    types::TypeFunction *function() { return fun->getTypeObject()->asFunction(); }

    /*
     * Get the non-eval script which this one is nested in, returning this script
     * if it was not produced as the result of an eval.
     */
    inline Script *evalParent();

    /* Bytecode where this script is nested. */
    inline Bytecode *parentCode();

    /* Gather statistics off this script and print it if necessary. */
    void finish(JSContext *cx);

    /* Helpers */

    /* Inference state destroyed after the initial pass through the function. */

    struct AnalyzeStateStack {
        /* Whether this node is the iterator for a 'for each' loop. */
        bool isForEach;

        /* Scope for any name binding pushed on this stack node, per SearchScope. */
        Script *scope;

        /* Any value pushed by a JSOP_DOUBLE. */
        bool hasDouble;
        double doubleValue;

        /* Whether this is or could be the constant zero. */
        bool isZero;

        /* Whether this is another constant. */
        bool isConstant;
    };

    struct AnalyzeState {
        AnalyzeStateStack *stack;

        /* Current stack depth. */
        unsigned stackDepth;

        /* Last opcode was JSOP_GETTER or JSOP_SETTER. */
        bool hasGetSet;

        /* Last opcode was JSOP_HOLE. */
        bool hasHole;

        /* Locals thought to be zero/constants. */
        bool zeroLocals[4];
        uint32 constLocals[4];
        unsigned numConstLocals;

        AnalyzeState()
            : stack(NULL), stackDepth(0), hasGetSet(false), hasHole(false), numConstLocals(0)
        {}

        bool init(JSContext *cx, JSScript *script)
        {
            if (script->nslots) {
                stack = (AnalyzeStateStack *)
                    cx->calloc(script->nslots * sizeof(AnalyzeStateStack));
                return (stack != NULL);
            }
            return true;
        }

        void destroy(JSContext *cx)
        {
            cx->free(stack);
        }

        AnalyzeStateStack &popped(unsigned i) {
            JS_ASSERT(i < stackDepth);
            return stack[stackDepth - 1 - i];
        }

        const AnalyzeStateStack &popped(unsigned i) const {
            JS_ASSERT(i < stackDepth);
            return stack[stackDepth - 1 - i];
        }

        void addConstLocal(uint32 local, bool zero) {
            if (numConstLocals == JS_ARRAY_LENGTH(constLocals))
                return;
            if (maybeLocalConst(local, false))
                return;
            zeroLocals[numConstLocals] = zero;
            constLocals[numConstLocals++] = local;
        }

        bool maybeLocalConst(uint32 local, bool zero) {
            for (unsigned i = 0; i < numConstLocals; i++) {
                if (constLocals[i] == local)
                    return !zero || zeroLocals[i];
            }
            return false;
        }

        void clearLocal(uint32 local) {
            for (unsigned i = 0; i < numConstLocals; i++) {
                if (constLocals[i] == local) {
                    constLocals[i] = constLocals[--numConstLocals];
                    return;
                }
            }
        }
    };

    /* Analyzes a bytecode, generating type constraints describing its behavior. */
    void analyzeTypes(JSContext *cx, Bytecode *code, AnalyzeState &state);

    /* Get the name to use for the local with specified index. */
    inline jsid getLocalId(unsigned index, Bytecode *code);

    /* Get the name to use for the argument with the specified index. */
    inline jsid getArgumentId(unsigned index);

    /* Get or make type information for the specified local/argument variable. */
    inline types::TypeSet *getVariable(JSContext *cx, jsid id);

    /* Get the type set to use for a stack slot at a fixed stack depth. */
    inline types::TypeSet *getStackTypes(unsigned index, Bytecode *code);

    /* Get any known type tag for an argument or local variable. */
    inline JSValueType knownArgumentTypeTag(JSContext *cx, JSScript *script, unsigned arg);
    inline JSValueType knownLocalTypeTag(JSContext *cx, JSScript *script, unsigned local);

    /* Helpers */

    void addVariable(JSContext *cx, jsid id, types::Variable *&var);
    void trace(JSTracer *trc);

#endif /* JS_TYPE_INFERENCE */

};

static inline unsigned
GetBytecodeLength(jsbytecode *pc)
{
    JSOp op = (JSOp)*pc;
    JS_ASSERT(op < JSOP_LIMIT);
    JS_ASSERT(op != JSOP_TRAP);

    if (js_CodeSpec[op].length != -1)
        return js_CodeSpec[op].length;
    return js_GetVariableBytecodeLength(pc);
}

static inline unsigned
GetUseCount(JSScript *script, unsigned offset)
{
    JS_ASSERT(offset < script->length);
    jsbytecode *pc = script->code + offset;
    if (js_CodeSpec[*pc].nuses == -1)
        return js_GetVariableStackUses(JSOp(*pc), pc);
    return js_CodeSpec[*pc].nuses;
}

static inline unsigned
GetDefCount(JSScript *script, unsigned offset)
{
    JS_ASSERT(offset < script->length);
    jsbytecode *pc = script->code + offset;
    if (js_CodeSpec[*pc].ndefs == -1)
        return js_GetEnterBlockStackDefs(NULL, script, pc);

    /*
     * Add an extra pushed value for OR/AND opcodes, so that they are included
     * in the pushed array of stack values for type inference.
     */
    switch (JSOp(*pc)) {
      case JSOP_OR:
      case JSOP_ORX:
      case JSOP_AND:
      case JSOP_ANDX:
        return 1;
      case JSOP_FILTER:
        return 2;
      default:
        return js_CodeSpec[*pc].ndefs;
    }
}

} /* namespace analyze */
} /* namespace js */

#endif // jsanalyze_h___
