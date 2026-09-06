#!/usr/bin/env node
// @bundle-source-hash: 7430a8073c625865a11fac5c0ad1f3336a842f00c85091c2860cfaa815bf2fb2
// @bun
var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
function __accessProp(key) {
  return this[key];
}
var __toESMCache_node;
var __toESMCache_esm;
var __toESM = (mod, isNodeMode, target) => {
  var canCache = mod != null && typeof mod === "object";
  if (canCache) {
    var cache = isNodeMode ? __toESMCache_node ??= new WeakMap : __toESMCache_esm ??= new WeakMap;
    var cached = cache.get(mod);
    if (cached)
      return cached;
  }
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  for (let key of __getOwnPropNames(mod))
    if (!__hasOwnProp.call(to, key))
      __defProp(to, key, {
        get: __accessProp.bind(mod, key),
        enumerable: true
      });
  if (canCache)
    cache.set(mod, to);
  return to;
};
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};
var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res);

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/codegen/code.js
var require_code = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.regexpCode = exports.getEsmExportName = exports.getProperty = exports.safeStringify = exports.stringify = exports.strConcat = exports.addCodeArg = exports.str = exports._ = exports.nil = exports._Code = exports.Name = exports.IDENTIFIER = exports._CodeOrName = undefined;

  class _CodeOrName {
  }
  exports._CodeOrName = _CodeOrName;
  exports.IDENTIFIER = /^[a-z$_][a-z$_0-9]*$/i;

  class Name extends _CodeOrName {
    constructor(s) {
      super();
      if (!exports.IDENTIFIER.test(s))
        throw new Error("CodeGen: name must be a valid identifier");
      this.str = s;
    }
    toString() {
      return this.str;
    }
    emptyStr() {
      return false;
    }
    get names() {
      return { [this.str]: 1 };
    }
  }
  exports.Name = Name;

  class _Code extends _CodeOrName {
    constructor(code) {
      super();
      this._items = typeof code === "string" ? [code] : code;
    }
    toString() {
      return this.str;
    }
    emptyStr() {
      if (this._items.length > 1)
        return false;
      const item = this._items[0];
      return item === "" || item === '""';
    }
    get str() {
      var _a;
      return (_a = this._str) !== null && _a !== undefined ? _a : this._str = this._items.reduce((s, c) => `${s}${c}`, "");
    }
    get names() {
      var _a;
      return (_a = this._names) !== null && _a !== undefined ? _a : this._names = this._items.reduce((names, c) => {
        if (c instanceof Name)
          names[c.str] = (names[c.str] || 0) + 1;
        return names;
      }, {});
    }
  }
  exports._Code = _Code;
  exports.nil = new _Code("");
  function _(strs, ...args) {
    const code = [strs[0]];
    let i = 0;
    while (i < args.length) {
      addCodeArg(code, args[i]);
      code.push(strs[++i]);
    }
    return new _Code(code);
  }
  exports._ = _;
  var plus = new _Code("+");
  function str(strs, ...args) {
    const expr = [safeStringify(strs[0])];
    let i = 0;
    while (i < args.length) {
      expr.push(plus);
      addCodeArg(expr, args[i]);
      expr.push(plus, safeStringify(strs[++i]));
    }
    optimize(expr);
    return new _Code(expr);
  }
  exports.str = str;
  function addCodeArg(code, arg) {
    if (arg instanceof _Code)
      code.push(...arg._items);
    else if (arg instanceof Name)
      code.push(arg);
    else
      code.push(interpolate(arg));
  }
  exports.addCodeArg = addCodeArg;
  function optimize(expr) {
    let i = 1;
    while (i < expr.length - 1) {
      if (expr[i] === plus) {
        const res = mergeExprItems(expr[i - 1], expr[i + 1]);
        if (res !== undefined) {
          expr.splice(i - 1, 3, res);
          continue;
        }
        expr[i++] = "+";
      }
      i++;
    }
  }
  function mergeExprItems(a, b) {
    if (b === '""')
      return a;
    if (a === '""')
      return b;
    if (typeof a == "string") {
      if (b instanceof Name || a[a.length - 1] !== '"')
        return;
      if (typeof b != "string")
        return `${a.slice(0, -1)}${b}"`;
      if (b[0] === '"')
        return a.slice(0, -1) + b.slice(1);
      return;
    }
    if (typeof b == "string" && b[0] === '"' && !(a instanceof Name))
      return `"${a}${b.slice(1)}`;
    return;
  }
  function strConcat(c1, c2) {
    return c2.emptyStr() ? c1 : c1.emptyStr() ? c2 : str`${c1}${c2}`;
  }
  exports.strConcat = strConcat;
  function interpolate(x) {
    return typeof x == "number" || typeof x == "boolean" || x === null ? x : safeStringify(Array.isArray(x) ? x.join(",") : x);
  }
  function stringify(x) {
    return new _Code(safeStringify(x));
  }
  exports.stringify = stringify;
  function safeStringify(x) {
    return JSON.stringify(x).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  }
  exports.safeStringify = safeStringify;
  function getProperty(key) {
    return typeof key == "string" && exports.IDENTIFIER.test(key) ? new _Code(`.${key}`) : _`[${key}]`;
  }
  exports.getProperty = getProperty;
  function getEsmExportName(key) {
    if (typeof key == "string" && exports.IDENTIFIER.test(key)) {
      return new _Code(`${key}`);
    }
    throw new Error(`CodeGen: invalid export name: ${key}, use explicit $id name mapping`);
  }
  exports.getEsmExportName = getEsmExportName;
  function regexpCode(rx) {
    return new _Code(rx.toString());
  }
  exports.regexpCode = regexpCode;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/codegen/scope.js
var require_scope = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.ValueScope = exports.ValueScopeName = exports.Scope = exports.varKinds = exports.UsedValueState = undefined;
  var code_1 = require_code();

  class ValueError extends Error {
    constructor(name) {
      super(`CodeGen: "code" for ${name} not defined`);
      this.value = name.value;
    }
  }
  var UsedValueState;
  (function(UsedValueState2) {
    UsedValueState2[UsedValueState2["Started"] = 0] = "Started";
    UsedValueState2[UsedValueState2["Completed"] = 1] = "Completed";
  })(UsedValueState || (exports.UsedValueState = UsedValueState = {}));
  exports.varKinds = {
    const: new code_1.Name("const"),
    let: new code_1.Name("let"),
    var: new code_1.Name("var")
  };

  class Scope {
    constructor({ prefixes, parent } = {}) {
      this._names = {};
      this._prefixes = prefixes;
      this._parent = parent;
    }
    toName(nameOrPrefix) {
      return nameOrPrefix instanceof code_1.Name ? nameOrPrefix : this.name(nameOrPrefix);
    }
    name(prefix) {
      return new code_1.Name(this._newName(prefix));
    }
    _newName(prefix) {
      const ng = this._names[prefix] || this._nameGroup(prefix);
      return `${prefix}${ng.index++}`;
    }
    _nameGroup(prefix) {
      var _a, _b;
      if (((_b = (_a = this._parent) === null || _a === undefined ? undefined : _a._prefixes) === null || _b === undefined ? undefined : _b.has(prefix)) || this._prefixes && !this._prefixes.has(prefix)) {
        throw new Error(`CodeGen: prefix "${prefix}" is not allowed in this scope`);
      }
      return this._names[prefix] = { prefix, index: 0 };
    }
  }
  exports.Scope = Scope;

  class ValueScopeName extends code_1.Name {
    constructor(prefix, nameStr) {
      super(nameStr);
      this.prefix = prefix;
    }
    setValue(value, { property, itemIndex }) {
      this.value = value;
      this.scopePath = (0, code_1._)`.${new code_1.Name(property)}[${itemIndex}]`;
    }
  }
  exports.ValueScopeName = ValueScopeName;
  var line = (0, code_1._)`\n`;

  class ValueScope extends Scope {
    constructor(opts) {
      super(opts);
      this._values = {};
      this._scope = opts.scope;
      this.opts = { ...opts, _n: opts.lines ? line : code_1.nil };
    }
    get() {
      return this._scope;
    }
    name(prefix) {
      return new ValueScopeName(prefix, this._newName(prefix));
    }
    value(nameOrPrefix, value) {
      var _a;
      if (value.ref === undefined)
        throw new Error("CodeGen: ref must be passed in value");
      const name = this.toName(nameOrPrefix);
      const { prefix } = name;
      const valueKey = (_a = value.key) !== null && _a !== undefined ? _a : value.ref;
      let vs = this._values[prefix];
      if (vs) {
        const _name = vs.get(valueKey);
        if (_name)
          return _name;
      } else {
        vs = this._values[prefix] = new Map;
      }
      vs.set(valueKey, name);
      const s = this._scope[prefix] || (this._scope[prefix] = []);
      const itemIndex = s.length;
      s[itemIndex] = value.ref;
      name.setValue(value, { property: prefix, itemIndex });
      return name;
    }
    getValue(prefix, keyOrRef) {
      const vs = this._values[prefix];
      if (!vs)
        return;
      return vs.get(keyOrRef);
    }
    scopeRefs(scopeName, values = this._values) {
      return this._reduceValues(values, (name) => {
        if (name.scopePath === undefined)
          throw new Error(`CodeGen: name "${name}" has no value`);
        return (0, code_1._)`${scopeName}${name.scopePath}`;
      });
    }
    scopeCode(values = this._values, usedValues, getCode) {
      return this._reduceValues(values, (name) => {
        if (name.value === undefined)
          throw new Error(`CodeGen: name "${name}" has no value`);
        return name.value.code;
      }, usedValues, getCode);
    }
    _reduceValues(values, valueCode, usedValues = {}, getCode) {
      let code = code_1.nil;
      for (const prefix in values) {
        const vs = values[prefix];
        if (!vs)
          continue;
        const nameSet = usedValues[prefix] = usedValues[prefix] || new Map;
        vs.forEach((name) => {
          if (nameSet.has(name))
            return;
          nameSet.set(name, UsedValueState.Started);
          let c = valueCode(name);
          if (c) {
            const def = this.opts.es5 ? exports.varKinds.var : exports.varKinds.const;
            code = (0, code_1._)`${code}${def} ${name} = ${c};${this.opts._n}`;
          } else if (c = getCode === null || getCode === undefined ? undefined : getCode(name)) {
            code = (0, code_1._)`${code}${c}${this.opts._n}`;
          } else {
            throw new ValueError(name);
          }
          nameSet.set(name, UsedValueState.Completed);
        });
      }
      return code;
    }
  }
  exports.ValueScope = ValueScope;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/codegen/index.js
var require_codegen = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.or = exports.and = exports.not = exports.CodeGen = exports.operators = exports.varKinds = exports.ValueScopeName = exports.ValueScope = exports.Scope = exports.Name = exports.regexpCode = exports.stringify = exports.getProperty = exports.nil = exports.strConcat = exports.str = exports._ = undefined;
  var code_1 = require_code();
  var scope_1 = require_scope();
  var code_2 = require_code();
  Object.defineProperty(exports, "_", { enumerable: true, get: function() {
    return code_2._;
  } });
  Object.defineProperty(exports, "str", { enumerable: true, get: function() {
    return code_2.str;
  } });
  Object.defineProperty(exports, "strConcat", { enumerable: true, get: function() {
    return code_2.strConcat;
  } });
  Object.defineProperty(exports, "nil", { enumerable: true, get: function() {
    return code_2.nil;
  } });
  Object.defineProperty(exports, "getProperty", { enumerable: true, get: function() {
    return code_2.getProperty;
  } });
  Object.defineProperty(exports, "stringify", { enumerable: true, get: function() {
    return code_2.stringify;
  } });
  Object.defineProperty(exports, "regexpCode", { enumerable: true, get: function() {
    return code_2.regexpCode;
  } });
  Object.defineProperty(exports, "Name", { enumerable: true, get: function() {
    return code_2.Name;
  } });
  var scope_2 = require_scope();
  Object.defineProperty(exports, "Scope", { enumerable: true, get: function() {
    return scope_2.Scope;
  } });
  Object.defineProperty(exports, "ValueScope", { enumerable: true, get: function() {
    return scope_2.ValueScope;
  } });
  Object.defineProperty(exports, "ValueScopeName", { enumerable: true, get: function() {
    return scope_2.ValueScopeName;
  } });
  Object.defineProperty(exports, "varKinds", { enumerable: true, get: function() {
    return scope_2.varKinds;
  } });
  exports.operators = {
    GT: new code_1._Code(">"),
    GTE: new code_1._Code(">="),
    LT: new code_1._Code("<"),
    LTE: new code_1._Code("<="),
    EQ: new code_1._Code("==="),
    NEQ: new code_1._Code("!=="),
    NOT: new code_1._Code("!"),
    OR: new code_1._Code("||"),
    AND: new code_1._Code("&&"),
    ADD: new code_1._Code("+")
  };

  class Node {
    optimizeNodes() {
      return this;
    }
    optimizeNames(_names, _constants) {
      return this;
    }
  }

  class Def extends Node {
    constructor(varKind, name, rhs) {
      super();
      this.varKind = varKind;
      this.name = name;
      this.rhs = rhs;
    }
    render({ es5, _n }) {
      const varKind = es5 ? scope_1.varKinds.var : this.varKind;
      const rhs = this.rhs === undefined ? "" : ` = ${this.rhs}`;
      return `${varKind} ${this.name}${rhs};` + _n;
    }
    optimizeNames(names, constants) {
      if (!names[this.name.str])
        return;
      if (this.rhs)
        this.rhs = optimizeExpr(this.rhs, names, constants);
      return this;
    }
    get names() {
      return this.rhs instanceof code_1._CodeOrName ? this.rhs.names : {};
    }
  }

  class Assign extends Node {
    constructor(lhs, rhs, sideEffects) {
      super();
      this.lhs = lhs;
      this.rhs = rhs;
      this.sideEffects = sideEffects;
    }
    render({ _n }) {
      return `${this.lhs} = ${this.rhs};` + _n;
    }
    optimizeNames(names, constants) {
      if (this.lhs instanceof code_1.Name && !names[this.lhs.str] && !this.sideEffects)
        return;
      this.rhs = optimizeExpr(this.rhs, names, constants);
      return this;
    }
    get names() {
      const names = this.lhs instanceof code_1.Name ? {} : { ...this.lhs.names };
      return addExprNames(names, this.rhs);
    }
  }

  class AssignOp extends Assign {
    constructor(lhs, op, rhs, sideEffects) {
      super(lhs, rhs, sideEffects);
      this.op = op;
    }
    render({ _n }) {
      return `${this.lhs} ${this.op}= ${this.rhs};` + _n;
    }
  }

  class Label extends Node {
    constructor(label) {
      super();
      this.label = label;
      this.names = {};
    }
    render({ _n }) {
      return `${this.label}:` + _n;
    }
  }

  class Break extends Node {
    constructor(label) {
      super();
      this.label = label;
      this.names = {};
    }
    render({ _n }) {
      const label = this.label ? ` ${this.label}` : "";
      return `break${label};` + _n;
    }
  }

  class Throw extends Node {
    constructor(error) {
      super();
      this.error = error;
    }
    render({ _n }) {
      return `throw ${this.error};` + _n;
    }
    get names() {
      return this.error.names;
    }
  }

  class AnyCode extends Node {
    constructor(code) {
      super();
      this.code = code;
    }
    render({ _n }) {
      return `${this.code};` + _n;
    }
    optimizeNodes() {
      return `${this.code}` ? this : undefined;
    }
    optimizeNames(names, constants) {
      this.code = optimizeExpr(this.code, names, constants);
      return this;
    }
    get names() {
      return this.code instanceof code_1._CodeOrName ? this.code.names : {};
    }
  }

  class ParentNode extends Node {
    constructor(nodes = []) {
      super();
      this.nodes = nodes;
    }
    render(opts) {
      return this.nodes.reduce((code, n) => code + n.render(opts), "");
    }
    optimizeNodes() {
      const { nodes } = this;
      let i = nodes.length;
      while (i--) {
        const n = nodes[i].optimizeNodes();
        if (Array.isArray(n))
          nodes.splice(i, 1, ...n);
        else if (n)
          nodes[i] = n;
        else
          nodes.splice(i, 1);
      }
      return nodes.length > 0 ? this : undefined;
    }
    optimizeNames(names, constants) {
      const { nodes } = this;
      let i = nodes.length;
      while (i--) {
        const n = nodes[i];
        if (n.optimizeNames(names, constants))
          continue;
        subtractNames(names, n.names);
        nodes.splice(i, 1);
      }
      return nodes.length > 0 ? this : undefined;
    }
    get names() {
      return this.nodes.reduce((names, n) => addNames(names, n.names), {});
    }
  }

  class BlockNode extends ParentNode {
    render(opts) {
      return "{" + opts._n + super.render(opts) + "}" + opts._n;
    }
  }

  class Root extends ParentNode {
  }

  class Else extends BlockNode {
  }
  Else.kind = "else";

  class If extends BlockNode {
    constructor(condition, nodes) {
      super(nodes);
      this.condition = condition;
    }
    render(opts) {
      let code = `if(${this.condition})` + super.render(opts);
      if (this.else)
        code += "else " + this.else.render(opts);
      return code;
    }
    optimizeNodes() {
      super.optimizeNodes();
      const cond = this.condition;
      if (cond === true)
        return this.nodes;
      let e = this.else;
      if (e) {
        const ns = e.optimizeNodes();
        e = this.else = Array.isArray(ns) ? new Else(ns) : ns;
      }
      if (e) {
        if (cond === false)
          return e instanceof If ? e : e.nodes;
        if (this.nodes.length)
          return this;
        return new If(not(cond), e instanceof If ? [e] : e.nodes);
      }
      if (cond === false || !this.nodes.length)
        return;
      return this;
    }
    optimizeNames(names, constants) {
      var _a;
      this.else = (_a = this.else) === null || _a === undefined ? undefined : _a.optimizeNames(names, constants);
      if (!(super.optimizeNames(names, constants) || this.else))
        return;
      this.condition = optimizeExpr(this.condition, names, constants);
      return this;
    }
    get names() {
      const names = super.names;
      addExprNames(names, this.condition);
      if (this.else)
        addNames(names, this.else.names);
      return names;
    }
  }
  If.kind = "if";

  class For extends BlockNode {
  }
  For.kind = "for";

  class ForLoop extends For {
    constructor(iteration) {
      super();
      this.iteration = iteration;
    }
    render(opts) {
      return `for(${this.iteration})` + super.render(opts);
    }
    optimizeNames(names, constants) {
      if (!super.optimizeNames(names, constants))
        return;
      this.iteration = optimizeExpr(this.iteration, names, constants);
      return this;
    }
    get names() {
      return addNames(super.names, this.iteration.names);
    }
  }

  class ForRange extends For {
    constructor(varKind, name, from, to) {
      super();
      this.varKind = varKind;
      this.name = name;
      this.from = from;
      this.to = to;
    }
    render(opts) {
      const varKind = opts.es5 ? scope_1.varKinds.var : this.varKind;
      const { name, from, to } = this;
      return `for(${varKind} ${name}=${from}; ${name}<${to}; ${name}++)` + super.render(opts);
    }
    get names() {
      const names = addExprNames(super.names, this.from);
      return addExprNames(names, this.to);
    }
  }

  class ForIter extends For {
    constructor(loop, varKind, name, iterable) {
      super();
      this.loop = loop;
      this.varKind = varKind;
      this.name = name;
      this.iterable = iterable;
    }
    render(opts) {
      return `for(${this.varKind} ${this.name} ${this.loop} ${this.iterable})` + super.render(opts);
    }
    optimizeNames(names, constants) {
      if (!super.optimizeNames(names, constants))
        return;
      this.iterable = optimizeExpr(this.iterable, names, constants);
      return this;
    }
    get names() {
      return addNames(super.names, this.iterable.names);
    }
  }

  class Func extends BlockNode {
    constructor(name, args, async) {
      super();
      this.name = name;
      this.args = args;
      this.async = async;
    }
    render(opts) {
      const _async = this.async ? "async " : "";
      return `${_async}function ${this.name}(${this.args})` + super.render(opts);
    }
  }
  Func.kind = "func";

  class Return extends ParentNode {
    render(opts) {
      return "return " + super.render(opts);
    }
  }
  Return.kind = "return";

  class Try extends BlockNode {
    render(opts) {
      let code = "try" + super.render(opts);
      if (this.catch)
        code += this.catch.render(opts);
      if (this.finally)
        code += this.finally.render(opts);
      return code;
    }
    optimizeNodes() {
      var _a, _b;
      super.optimizeNodes();
      (_a = this.catch) === null || _a === undefined || _a.optimizeNodes();
      (_b = this.finally) === null || _b === undefined || _b.optimizeNodes();
      return this;
    }
    optimizeNames(names, constants) {
      var _a, _b;
      super.optimizeNames(names, constants);
      (_a = this.catch) === null || _a === undefined || _a.optimizeNames(names, constants);
      (_b = this.finally) === null || _b === undefined || _b.optimizeNames(names, constants);
      return this;
    }
    get names() {
      const names = super.names;
      if (this.catch)
        addNames(names, this.catch.names);
      if (this.finally)
        addNames(names, this.finally.names);
      return names;
    }
  }

  class Catch extends BlockNode {
    constructor(error) {
      super();
      this.error = error;
    }
    render(opts) {
      return `catch(${this.error})` + super.render(opts);
    }
  }
  Catch.kind = "catch";

  class Finally extends BlockNode {
    render(opts) {
      return "finally" + super.render(opts);
    }
  }
  Finally.kind = "finally";

  class CodeGen {
    constructor(extScope, opts = {}) {
      this._values = {};
      this._blockStarts = [];
      this._constants = {};
      this.opts = { ...opts, _n: opts.lines ? `
` : "" };
      this._extScope = extScope;
      this._scope = new scope_1.Scope({ parent: extScope });
      this._nodes = [new Root];
    }
    toString() {
      return this._root.render(this.opts);
    }
    name(prefix) {
      return this._scope.name(prefix);
    }
    scopeName(prefix) {
      return this._extScope.name(prefix);
    }
    scopeValue(prefixOrName, value) {
      const name = this._extScope.value(prefixOrName, value);
      const vs = this._values[name.prefix] || (this._values[name.prefix] = new Set);
      vs.add(name);
      return name;
    }
    getScopeValue(prefix, keyOrRef) {
      return this._extScope.getValue(prefix, keyOrRef);
    }
    scopeRefs(scopeName) {
      return this._extScope.scopeRefs(scopeName, this._values);
    }
    scopeCode() {
      return this._extScope.scopeCode(this._values);
    }
    _def(varKind, nameOrPrefix, rhs, constant) {
      const name = this._scope.toName(nameOrPrefix);
      if (rhs !== undefined && constant)
        this._constants[name.str] = rhs;
      this._leafNode(new Def(varKind, name, rhs));
      return name;
    }
    const(nameOrPrefix, rhs, _constant) {
      return this._def(scope_1.varKinds.const, nameOrPrefix, rhs, _constant);
    }
    let(nameOrPrefix, rhs, _constant) {
      return this._def(scope_1.varKinds.let, nameOrPrefix, rhs, _constant);
    }
    var(nameOrPrefix, rhs, _constant) {
      return this._def(scope_1.varKinds.var, nameOrPrefix, rhs, _constant);
    }
    assign(lhs, rhs, sideEffects) {
      return this._leafNode(new Assign(lhs, rhs, sideEffects));
    }
    add(lhs, rhs) {
      return this._leafNode(new AssignOp(lhs, exports.operators.ADD, rhs));
    }
    code(c) {
      if (typeof c == "function")
        c();
      else if (c !== code_1.nil)
        this._leafNode(new AnyCode(c));
      return this;
    }
    object(...keyValues) {
      const code = ["{"];
      for (const [key, value] of keyValues) {
        if (code.length > 1)
          code.push(",");
        code.push(key);
        if (key !== value || this.opts.es5) {
          code.push(":");
          (0, code_1.addCodeArg)(code, value);
        }
      }
      code.push("}");
      return new code_1._Code(code);
    }
    if(condition, thenBody, elseBody) {
      this._blockNode(new If(condition));
      if (thenBody && elseBody) {
        this.code(thenBody).else().code(elseBody).endIf();
      } else if (thenBody) {
        this.code(thenBody).endIf();
      } else if (elseBody) {
        throw new Error('CodeGen: "else" body without "then" body');
      }
      return this;
    }
    elseIf(condition) {
      return this._elseNode(new If(condition));
    }
    else() {
      return this._elseNode(new Else);
    }
    endIf() {
      return this._endBlockNode(If, Else);
    }
    _for(node, forBody) {
      this._blockNode(node);
      if (forBody)
        this.code(forBody).endFor();
      return this;
    }
    for(iteration, forBody) {
      return this._for(new ForLoop(iteration), forBody);
    }
    forRange(nameOrPrefix, from, to, forBody, varKind = this.opts.es5 ? scope_1.varKinds.var : scope_1.varKinds.let) {
      const name = this._scope.toName(nameOrPrefix);
      return this._for(new ForRange(varKind, name, from, to), () => forBody(name));
    }
    forOf(nameOrPrefix, iterable, forBody, varKind = scope_1.varKinds.const) {
      const name = this._scope.toName(nameOrPrefix);
      if (this.opts.es5) {
        const arr = iterable instanceof code_1.Name ? iterable : this.var("_arr", iterable);
        return this.forRange("_i", 0, (0, code_1._)`${arr}.length`, (i) => {
          this.var(name, (0, code_1._)`${arr}[${i}]`);
          forBody(name);
        });
      }
      return this._for(new ForIter("of", varKind, name, iterable), () => forBody(name));
    }
    forIn(nameOrPrefix, obj, forBody, varKind = this.opts.es5 ? scope_1.varKinds.var : scope_1.varKinds.const) {
      if (this.opts.ownProperties) {
        return this.forOf(nameOrPrefix, (0, code_1._)`Object.keys(${obj})`, forBody);
      }
      const name = this._scope.toName(nameOrPrefix);
      return this._for(new ForIter("in", varKind, name, obj), () => forBody(name));
    }
    endFor() {
      return this._endBlockNode(For);
    }
    label(label) {
      return this._leafNode(new Label(label));
    }
    break(label) {
      return this._leafNode(new Break(label));
    }
    return(value) {
      const node = new Return;
      this._blockNode(node);
      this.code(value);
      if (node.nodes.length !== 1)
        throw new Error('CodeGen: "return" should have one node');
      return this._endBlockNode(Return);
    }
    try(tryBody, catchCode, finallyCode) {
      if (!catchCode && !finallyCode)
        throw new Error('CodeGen: "try" without "catch" and "finally"');
      const node = new Try;
      this._blockNode(node);
      this.code(tryBody);
      if (catchCode) {
        const error = this.name("e");
        this._currNode = node.catch = new Catch(error);
        catchCode(error);
      }
      if (finallyCode) {
        this._currNode = node.finally = new Finally;
        this.code(finallyCode);
      }
      return this._endBlockNode(Catch, Finally);
    }
    throw(error) {
      return this._leafNode(new Throw(error));
    }
    block(body, nodeCount) {
      this._blockStarts.push(this._nodes.length);
      if (body)
        this.code(body).endBlock(nodeCount);
      return this;
    }
    endBlock(nodeCount) {
      const len = this._blockStarts.pop();
      if (len === undefined)
        throw new Error("CodeGen: not in self-balancing block");
      const toClose = this._nodes.length - len;
      if (toClose < 0 || nodeCount !== undefined && toClose !== nodeCount) {
        throw new Error(`CodeGen: wrong number of nodes: ${toClose} vs ${nodeCount} expected`);
      }
      this._nodes.length = len;
      return this;
    }
    func(name, args = code_1.nil, async, funcBody) {
      this._blockNode(new Func(name, args, async));
      if (funcBody)
        this.code(funcBody).endFunc();
      return this;
    }
    endFunc() {
      return this._endBlockNode(Func);
    }
    optimize(n = 1) {
      while (n-- > 0) {
        this._root.optimizeNodes();
        this._root.optimizeNames(this._root.names, this._constants);
      }
    }
    _leafNode(node) {
      this._currNode.nodes.push(node);
      return this;
    }
    _blockNode(node) {
      this._currNode.nodes.push(node);
      this._nodes.push(node);
    }
    _endBlockNode(N1, N2) {
      const n = this._currNode;
      if (n instanceof N1 || N2 && n instanceof N2) {
        this._nodes.pop();
        return this;
      }
      throw new Error(`CodeGen: not in block "${N2 ? `${N1.kind}/${N2.kind}` : N1.kind}"`);
    }
    _elseNode(node) {
      const n = this._currNode;
      if (!(n instanceof If)) {
        throw new Error('CodeGen: "else" without "if"');
      }
      this._currNode = n.else = node;
      return this;
    }
    get _root() {
      return this._nodes[0];
    }
    get _currNode() {
      const ns = this._nodes;
      return ns[ns.length - 1];
    }
    set _currNode(node) {
      const ns = this._nodes;
      ns[ns.length - 1] = node;
    }
  }
  exports.CodeGen = CodeGen;
  function addNames(names, from) {
    for (const n in from)
      names[n] = (names[n] || 0) + (from[n] || 0);
    return names;
  }
  function addExprNames(names, from) {
    return from instanceof code_1._CodeOrName ? addNames(names, from.names) : names;
  }
  function optimizeExpr(expr, names, constants) {
    if (expr instanceof code_1.Name)
      return replaceName(expr);
    if (!canOptimize(expr))
      return expr;
    return new code_1._Code(expr._items.reduce((items, c) => {
      if (c instanceof code_1.Name)
        c = replaceName(c);
      if (c instanceof code_1._Code)
        items.push(...c._items);
      else
        items.push(c);
      return items;
    }, []));
    function replaceName(n) {
      const c = constants[n.str];
      if (c === undefined || names[n.str] !== 1)
        return n;
      delete names[n.str];
      return c;
    }
    function canOptimize(e) {
      return e instanceof code_1._Code && e._items.some((c) => c instanceof code_1.Name && names[c.str] === 1 && constants[c.str] !== undefined);
    }
  }
  function subtractNames(names, from) {
    for (const n in from)
      names[n] = (names[n] || 0) - (from[n] || 0);
  }
  function not(x) {
    return typeof x == "boolean" || typeof x == "number" || x === null ? !x : (0, code_1._)`!${par(x)}`;
  }
  exports.not = not;
  var andCode = mappend(exports.operators.AND);
  function and(...args) {
    return args.reduce(andCode);
  }
  exports.and = and;
  var orCode = mappend(exports.operators.OR);
  function or(...args) {
    return args.reduce(orCode);
  }
  exports.or = or;
  function mappend(op) {
    return (x, y) => x === code_1.nil ? y : y === code_1.nil ? x : (0, code_1._)`${par(x)} ${op} ${par(y)}`;
  }
  function par(x) {
    return x instanceof code_1.Name ? x : (0, code_1._)`(${x})`;
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/util.js
var require_util = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.checkStrictMode = exports.getErrorPath = exports.Type = exports.useFunc = exports.setEvaluated = exports.evaluatedPropsToName = exports.mergeEvaluated = exports.eachItem = exports.unescapeJsonPointer = exports.escapeJsonPointer = exports.escapeFragment = exports.unescapeFragment = exports.schemaRefOrVal = exports.schemaHasRulesButRef = exports.schemaHasRules = exports.checkUnknownRules = exports.alwaysValidSchema = exports.toHash = undefined;
  var codegen_1 = require_codegen();
  var code_1 = require_code();
  function toHash(arr) {
    const hash = {};
    for (const item of arr)
      hash[item] = true;
    return hash;
  }
  exports.toHash = toHash;
  function alwaysValidSchema(it, schema) {
    if (typeof schema == "boolean")
      return schema;
    if (Object.keys(schema).length === 0)
      return true;
    checkUnknownRules(it, schema);
    return !schemaHasRules(schema, it.self.RULES.all);
  }
  exports.alwaysValidSchema = alwaysValidSchema;
  function checkUnknownRules(it, schema = it.schema) {
    const { opts, self } = it;
    if (!opts.strictSchema)
      return;
    if (typeof schema === "boolean")
      return;
    const rules = self.RULES.keywords;
    for (const key in schema) {
      if (!rules[key])
        checkStrictMode(it, `unknown keyword: "${key}"`);
    }
  }
  exports.checkUnknownRules = checkUnknownRules;
  function schemaHasRules(schema, rules) {
    if (typeof schema == "boolean")
      return !schema;
    for (const key in schema)
      if (rules[key])
        return true;
    return false;
  }
  exports.schemaHasRules = schemaHasRules;
  function schemaHasRulesButRef(schema, RULES) {
    if (typeof schema == "boolean")
      return !schema;
    for (const key in schema)
      if (key !== "$ref" && RULES.all[key])
        return true;
    return false;
  }
  exports.schemaHasRulesButRef = schemaHasRulesButRef;
  function schemaRefOrVal({ topSchemaRef, schemaPath }, schema, keyword, $data) {
    if (!$data) {
      if (typeof schema == "number" || typeof schema == "boolean")
        return schema;
      if (typeof schema == "string")
        return (0, codegen_1._)`${schema}`;
    }
    return (0, codegen_1._)`${topSchemaRef}${schemaPath}${(0, codegen_1.getProperty)(keyword)}`;
  }
  exports.schemaRefOrVal = schemaRefOrVal;
  function unescapeFragment(str) {
    return unescapeJsonPointer(decodeURIComponent(str));
  }
  exports.unescapeFragment = unescapeFragment;
  function escapeFragment(str) {
    return encodeURIComponent(escapeJsonPointer(str));
  }
  exports.escapeFragment = escapeFragment;
  function escapeJsonPointer(str) {
    if (typeof str == "number")
      return `${str}`;
    return str.replace(/~/g, "~0").replace(/\//g, "~1");
  }
  exports.escapeJsonPointer = escapeJsonPointer;
  function unescapeJsonPointer(str) {
    return str.replace(/~1/g, "/").replace(/~0/g, "~");
  }
  exports.unescapeJsonPointer = unescapeJsonPointer;
  function eachItem(xs, f) {
    if (Array.isArray(xs)) {
      for (const x of xs)
        f(x);
    } else {
      f(xs);
    }
  }
  exports.eachItem = eachItem;
  function makeMergeEvaluated({ mergeNames, mergeToName, mergeValues, resultToName }) {
    return (gen, from, to, toName) => {
      const res = to === undefined ? from : to instanceof codegen_1.Name ? (from instanceof codegen_1.Name ? mergeNames(gen, from, to) : mergeToName(gen, from, to), to) : from instanceof codegen_1.Name ? (mergeToName(gen, to, from), from) : mergeValues(from, to);
      return toName === codegen_1.Name && !(res instanceof codegen_1.Name) ? resultToName(gen, res) : res;
    };
  }
  exports.mergeEvaluated = {
    props: makeMergeEvaluated({
      mergeNames: (gen, from, to) => gen.if((0, codegen_1._)`${to} !== true && ${from} !== undefined`, () => {
        gen.if((0, codegen_1._)`${from} === true`, () => gen.assign(to, true), () => gen.assign(to, (0, codegen_1._)`${to} || {}`).code((0, codegen_1._)`Object.assign(${to}, ${from})`));
      }),
      mergeToName: (gen, from, to) => gen.if((0, codegen_1._)`${to} !== true`, () => {
        if (from === true) {
          gen.assign(to, true);
        } else {
          gen.assign(to, (0, codegen_1._)`${to} || {}`);
          setEvaluated(gen, to, from);
        }
      }),
      mergeValues: (from, to) => from === true ? true : { ...from, ...to },
      resultToName: evaluatedPropsToName
    }),
    items: makeMergeEvaluated({
      mergeNames: (gen, from, to) => gen.if((0, codegen_1._)`${to} !== true && ${from} !== undefined`, () => gen.assign(to, (0, codegen_1._)`${from} === true ? true : ${to} > ${from} ? ${to} : ${from}`)),
      mergeToName: (gen, from, to) => gen.if((0, codegen_1._)`${to} !== true`, () => gen.assign(to, from === true ? true : (0, codegen_1._)`${to} > ${from} ? ${to} : ${from}`)),
      mergeValues: (from, to) => from === true ? true : Math.max(from, to),
      resultToName: (gen, items) => gen.var("items", items)
    })
  };
  function evaluatedPropsToName(gen, ps) {
    if (ps === true)
      return gen.var("props", true);
    const props = gen.var("props", (0, codegen_1._)`{}`);
    if (ps !== undefined)
      setEvaluated(gen, props, ps);
    return props;
  }
  exports.evaluatedPropsToName = evaluatedPropsToName;
  function setEvaluated(gen, props, ps) {
    Object.keys(ps).forEach((p) => gen.assign((0, codegen_1._)`${props}${(0, codegen_1.getProperty)(p)}`, true));
  }
  exports.setEvaluated = setEvaluated;
  var snippets = {};
  function useFunc(gen, f) {
    return gen.scopeValue("func", {
      ref: f,
      code: snippets[f.code] || (snippets[f.code] = new code_1._Code(f.code))
    });
  }
  exports.useFunc = useFunc;
  var Type;
  (function(Type2) {
    Type2[Type2["Num"] = 0] = "Num";
    Type2[Type2["Str"] = 1] = "Str";
  })(Type || (exports.Type = Type = {}));
  function getErrorPath(dataProp, dataPropType, jsPropertySyntax) {
    if (dataProp instanceof codegen_1.Name) {
      const isNumber = dataPropType === Type.Num;
      return jsPropertySyntax ? isNumber ? (0, codegen_1._)`"[" + ${dataProp} + "]"` : (0, codegen_1._)`"['" + ${dataProp} + "']"` : isNumber ? (0, codegen_1._)`"/" + ${dataProp}` : (0, codegen_1._)`"/" + ${dataProp}.replace(/~/g, "~0").replace(/\\//g, "~1")`;
    }
    return jsPropertySyntax ? (0, codegen_1.getProperty)(dataProp).toString() : "/" + escapeJsonPointer(dataProp);
  }
  exports.getErrorPath = getErrorPath;
  function checkStrictMode(it, msg, mode = it.opts.strictSchema) {
    if (!mode)
      return;
    msg = `strict mode: ${msg}`;
    if (mode === true)
      throw new Error(msg);
    it.self.logger.warn(msg);
  }
  exports.checkStrictMode = checkStrictMode;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/names.js
var require_names = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var codegen_1 = require_codegen();
  var names = {
    data: new codegen_1.Name("data"),
    valCxt: new codegen_1.Name("valCxt"),
    instancePath: new codegen_1.Name("instancePath"),
    parentData: new codegen_1.Name("parentData"),
    parentDataProperty: new codegen_1.Name("parentDataProperty"),
    rootData: new codegen_1.Name("rootData"),
    dynamicAnchors: new codegen_1.Name("dynamicAnchors"),
    vErrors: new codegen_1.Name("vErrors"),
    errors: new codegen_1.Name("errors"),
    this: new codegen_1.Name("this"),
    self: new codegen_1.Name("self"),
    scope: new codegen_1.Name("scope"),
    json: new codegen_1.Name("json"),
    jsonPos: new codegen_1.Name("jsonPos"),
    jsonLen: new codegen_1.Name("jsonLen"),
    jsonPart: new codegen_1.Name("jsonPart")
  };
  exports.default = names;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/errors.js
var require_errors = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.extendErrors = exports.resetErrorsCount = exports.reportExtraError = exports.reportError = exports.keyword$DataError = exports.keywordError = undefined;
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  var names_1 = require_names();
  exports.keywordError = {
    message: ({ keyword }) => (0, codegen_1.str)`must pass "${keyword}" keyword validation`
  };
  exports.keyword$DataError = {
    message: ({ keyword, schemaType }) => schemaType ? (0, codegen_1.str)`"${keyword}" keyword must be ${schemaType} ($data)` : (0, codegen_1.str)`"${keyword}" keyword is invalid ($data)`
  };
  function reportError(cxt, error = exports.keywordError, errorPaths, overrideAllErrors) {
    const { it } = cxt;
    const { gen, compositeRule, allErrors } = it;
    const errObj = errorObjectCode(cxt, error, errorPaths);
    if (overrideAllErrors !== null && overrideAllErrors !== undefined ? overrideAllErrors : compositeRule || allErrors) {
      addError(gen, errObj);
    } else {
      returnErrors(it, (0, codegen_1._)`[${errObj}]`);
    }
  }
  exports.reportError = reportError;
  function reportExtraError(cxt, error = exports.keywordError, errorPaths) {
    const { it } = cxt;
    const { gen, compositeRule, allErrors } = it;
    const errObj = errorObjectCode(cxt, error, errorPaths);
    addError(gen, errObj);
    if (!(compositeRule || allErrors)) {
      returnErrors(it, names_1.default.vErrors);
    }
  }
  exports.reportExtraError = reportExtraError;
  function resetErrorsCount(gen, errsCount) {
    gen.assign(names_1.default.errors, errsCount);
    gen.if((0, codegen_1._)`${names_1.default.vErrors} !== null`, () => gen.if(errsCount, () => gen.assign((0, codegen_1._)`${names_1.default.vErrors}.length`, errsCount), () => gen.assign(names_1.default.vErrors, null)));
  }
  exports.resetErrorsCount = resetErrorsCount;
  function extendErrors({ gen, keyword, schemaValue, data, errsCount, it }) {
    if (errsCount === undefined)
      throw new Error("ajv implementation error");
    const err = gen.name("err");
    gen.forRange("i", errsCount, names_1.default.errors, (i) => {
      gen.const(err, (0, codegen_1._)`${names_1.default.vErrors}[${i}]`);
      gen.if((0, codegen_1._)`${err}.instancePath === undefined`, () => gen.assign((0, codegen_1._)`${err}.instancePath`, (0, codegen_1.strConcat)(names_1.default.instancePath, it.errorPath)));
      gen.assign((0, codegen_1._)`${err}.schemaPath`, (0, codegen_1.str)`${it.errSchemaPath}/${keyword}`);
      if (it.opts.verbose) {
        gen.assign((0, codegen_1._)`${err}.schema`, schemaValue);
        gen.assign((0, codegen_1._)`${err}.data`, data);
      }
    });
  }
  exports.extendErrors = extendErrors;
  function addError(gen, errObj) {
    const err = gen.const("err", errObj);
    gen.if((0, codegen_1._)`${names_1.default.vErrors} === null`, () => gen.assign(names_1.default.vErrors, (0, codegen_1._)`[${err}]`), (0, codegen_1._)`${names_1.default.vErrors}.push(${err})`);
    gen.code((0, codegen_1._)`${names_1.default.errors}++`);
  }
  function returnErrors(it, errs) {
    const { gen, validateName, schemaEnv } = it;
    if (schemaEnv.$async) {
      gen.throw((0, codegen_1._)`new ${it.ValidationError}(${errs})`);
    } else {
      gen.assign((0, codegen_1._)`${validateName}.errors`, errs);
      gen.return(false);
    }
  }
  var E = {
    keyword: new codegen_1.Name("keyword"),
    schemaPath: new codegen_1.Name("schemaPath"),
    params: new codegen_1.Name("params"),
    propertyName: new codegen_1.Name("propertyName"),
    message: new codegen_1.Name("message"),
    schema: new codegen_1.Name("schema"),
    parentSchema: new codegen_1.Name("parentSchema")
  };
  function errorObjectCode(cxt, error, errorPaths) {
    const { createErrors } = cxt.it;
    if (createErrors === false)
      return (0, codegen_1._)`{}`;
    return errorObject(cxt, error, errorPaths);
  }
  function errorObject(cxt, error, errorPaths = {}) {
    const { gen, it } = cxt;
    const keyValues = [
      errorInstancePath(it, errorPaths),
      errorSchemaPath(cxt, errorPaths)
    ];
    extraErrorProps(cxt, error, keyValues);
    return gen.object(...keyValues);
  }
  function errorInstancePath({ errorPath }, { instancePath }) {
    const instPath = instancePath ? (0, codegen_1.str)`${errorPath}${(0, util_1.getErrorPath)(instancePath, util_1.Type.Str)}` : errorPath;
    return [names_1.default.instancePath, (0, codegen_1.strConcat)(names_1.default.instancePath, instPath)];
  }
  function errorSchemaPath({ keyword, it: { errSchemaPath } }, { schemaPath, parentSchema }) {
    let schPath = parentSchema ? errSchemaPath : (0, codegen_1.str)`${errSchemaPath}/${keyword}`;
    if (schemaPath) {
      schPath = (0, codegen_1.str)`${schPath}${(0, util_1.getErrorPath)(schemaPath, util_1.Type.Str)}`;
    }
    return [E.schemaPath, schPath];
  }
  function extraErrorProps(cxt, { params, message }, keyValues) {
    const { keyword, data, schemaValue, it } = cxt;
    const { opts, propertyName, topSchemaRef, schemaPath } = it;
    keyValues.push([E.keyword, keyword], [E.params, typeof params == "function" ? params(cxt) : params || (0, codegen_1._)`{}`]);
    if (opts.messages) {
      keyValues.push([E.message, typeof message == "function" ? message(cxt) : message]);
    }
    if (opts.verbose) {
      keyValues.push([E.schema, schemaValue], [E.parentSchema, (0, codegen_1._)`${topSchemaRef}${schemaPath}`], [names_1.default.data, data]);
    }
    if (propertyName)
      keyValues.push([E.propertyName, propertyName]);
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/validate/boolSchema.js
var require_boolSchema = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.boolOrEmptySchema = exports.topBoolOrEmptySchema = undefined;
  var errors_1 = require_errors();
  var codegen_1 = require_codegen();
  var names_1 = require_names();
  var boolError = {
    message: "boolean schema is false"
  };
  function topBoolOrEmptySchema(it) {
    const { gen, schema, validateName } = it;
    if (schema === false) {
      falseSchemaError(it, false);
    } else if (typeof schema == "object" && schema.$async === true) {
      gen.return(names_1.default.data);
    } else {
      gen.assign((0, codegen_1._)`${validateName}.errors`, null);
      gen.return(true);
    }
  }
  exports.topBoolOrEmptySchema = topBoolOrEmptySchema;
  function boolOrEmptySchema(it, valid) {
    const { gen, schema } = it;
    if (schema === false) {
      gen.var(valid, false);
      falseSchemaError(it);
    } else {
      gen.var(valid, true);
    }
  }
  exports.boolOrEmptySchema = boolOrEmptySchema;
  function falseSchemaError(it, overrideAllErrors) {
    const { gen, data } = it;
    const cxt = {
      gen,
      keyword: "false schema",
      data,
      schema: false,
      schemaCode: false,
      schemaValue: false,
      params: {},
      it
    };
    (0, errors_1.reportError)(cxt, boolError, undefined, overrideAllErrors);
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/rules.js
var require_rules = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.getRules = exports.isJSONType = undefined;
  var _jsonTypes = ["string", "number", "integer", "boolean", "null", "object", "array"];
  var jsonTypes = new Set(_jsonTypes);
  function isJSONType(x) {
    return typeof x == "string" && jsonTypes.has(x);
  }
  exports.isJSONType = isJSONType;
  function getRules() {
    const groups = {
      number: { type: "number", rules: [] },
      string: { type: "string", rules: [] },
      array: { type: "array", rules: [] },
      object: { type: "object", rules: [] }
    };
    return {
      types: { ...groups, integer: true, boolean: true, null: true },
      rules: [{ rules: [] }, groups.number, groups.string, groups.array, groups.object],
      post: { rules: [] },
      all: {},
      keywords: {}
    };
  }
  exports.getRules = getRules;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/validate/applicability.js
var require_applicability = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.shouldUseRule = exports.shouldUseGroup = exports.schemaHasRulesForType = undefined;
  function schemaHasRulesForType({ schema, self }, type) {
    const group = self.RULES.types[type];
    return group && group !== true && shouldUseGroup(schema, group);
  }
  exports.schemaHasRulesForType = schemaHasRulesForType;
  function shouldUseGroup(schema, group) {
    return group.rules.some((rule) => shouldUseRule(schema, rule));
  }
  exports.shouldUseGroup = shouldUseGroup;
  function shouldUseRule(schema, rule) {
    var _a;
    return schema[rule.keyword] !== undefined || ((_a = rule.definition.implements) === null || _a === undefined ? undefined : _a.some((kwd) => schema[kwd] !== undefined));
  }
  exports.shouldUseRule = shouldUseRule;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/validate/dataType.js
var require_dataType = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.reportTypeError = exports.checkDataTypes = exports.checkDataType = exports.coerceAndCheckDataType = exports.getJSONTypes = exports.getSchemaTypes = exports.DataType = undefined;
  var rules_1 = require_rules();
  var applicability_1 = require_applicability();
  var errors_1 = require_errors();
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  var DataType;
  (function(DataType2) {
    DataType2[DataType2["Correct"] = 0] = "Correct";
    DataType2[DataType2["Wrong"] = 1] = "Wrong";
  })(DataType || (exports.DataType = DataType = {}));
  function getSchemaTypes(schema) {
    const types = getJSONTypes(schema.type);
    const hasNull = types.includes("null");
    if (hasNull) {
      if (schema.nullable === false)
        throw new Error("type: null contradicts nullable: false");
    } else {
      if (!types.length && schema.nullable !== undefined) {
        throw new Error('"nullable" cannot be used without "type"');
      }
      if (schema.nullable === true)
        types.push("null");
    }
    return types;
  }
  exports.getSchemaTypes = getSchemaTypes;
  function getJSONTypes(ts) {
    const types = Array.isArray(ts) ? ts : ts ? [ts] : [];
    if (types.every(rules_1.isJSONType))
      return types;
    throw new Error("type must be JSONType or JSONType[]: " + types.join(","));
  }
  exports.getJSONTypes = getJSONTypes;
  function coerceAndCheckDataType(it, types) {
    const { gen, data, opts } = it;
    const coerceTo = coerceToTypes(types, opts.coerceTypes);
    const checkTypes = types.length > 0 && !(coerceTo.length === 0 && types.length === 1 && (0, applicability_1.schemaHasRulesForType)(it, types[0]));
    if (checkTypes) {
      const wrongType = checkDataTypes(types, data, opts.strictNumbers, DataType.Wrong);
      gen.if(wrongType, () => {
        if (coerceTo.length)
          coerceData(it, types, coerceTo);
        else
          reportTypeError(it);
      });
    }
    return checkTypes;
  }
  exports.coerceAndCheckDataType = coerceAndCheckDataType;
  var COERCIBLE = new Set(["string", "number", "integer", "boolean", "null"]);
  function coerceToTypes(types, coerceTypes) {
    return coerceTypes ? types.filter((t) => COERCIBLE.has(t) || coerceTypes === "array" && t === "array") : [];
  }
  function coerceData(it, types, coerceTo) {
    const { gen, data, opts } = it;
    const dataType = gen.let("dataType", (0, codegen_1._)`typeof ${data}`);
    const coerced = gen.let("coerced", (0, codegen_1._)`undefined`);
    if (opts.coerceTypes === "array") {
      gen.if((0, codegen_1._)`${dataType} == 'object' && Array.isArray(${data}) && ${data}.length == 1`, () => gen.assign(data, (0, codegen_1._)`${data}[0]`).assign(dataType, (0, codegen_1._)`typeof ${data}`).if(checkDataTypes(types, data, opts.strictNumbers), () => gen.assign(coerced, data)));
    }
    gen.if((0, codegen_1._)`${coerced} !== undefined`);
    for (const t of coerceTo) {
      if (COERCIBLE.has(t) || t === "array" && opts.coerceTypes === "array") {
        coerceSpecificType(t);
      }
    }
    gen.else();
    reportTypeError(it);
    gen.endIf();
    gen.if((0, codegen_1._)`${coerced} !== undefined`, () => {
      gen.assign(data, coerced);
      assignParentData(it, coerced);
    });
    function coerceSpecificType(t) {
      switch (t) {
        case "string":
          gen.elseIf((0, codegen_1._)`${dataType} == "number" || ${dataType} == "boolean"`).assign(coerced, (0, codegen_1._)`"" + ${data}`).elseIf((0, codegen_1._)`${data} === null`).assign(coerced, (0, codegen_1._)`""`);
          return;
        case "number":
          gen.elseIf((0, codegen_1._)`${dataType} == "boolean" || ${data} === null
              || (${dataType} == "string" && ${data} && ${data} == +${data})`).assign(coerced, (0, codegen_1._)`+${data}`);
          return;
        case "integer":
          gen.elseIf((0, codegen_1._)`${dataType} === "boolean" || ${data} === null
              || (${dataType} === "string" && ${data} && ${data} == +${data} && !(${data} % 1))`).assign(coerced, (0, codegen_1._)`+${data}`);
          return;
        case "boolean":
          gen.elseIf((0, codegen_1._)`${data} === "false" || ${data} === 0 || ${data} === null`).assign(coerced, false).elseIf((0, codegen_1._)`${data} === "true" || ${data} === 1`).assign(coerced, true);
          return;
        case "null":
          gen.elseIf((0, codegen_1._)`${data} === "" || ${data} === 0 || ${data} === false`);
          gen.assign(coerced, null);
          return;
        case "array":
          gen.elseIf((0, codegen_1._)`${dataType} === "string" || ${dataType} === "number"
              || ${dataType} === "boolean" || ${data} === null`).assign(coerced, (0, codegen_1._)`[${data}]`);
      }
    }
  }
  function assignParentData({ gen, parentData, parentDataProperty }, expr) {
    gen.if((0, codegen_1._)`${parentData} !== undefined`, () => gen.assign((0, codegen_1._)`${parentData}[${parentDataProperty}]`, expr));
  }
  function checkDataType(dataType, data, strictNums, correct = DataType.Correct) {
    const EQ = correct === DataType.Correct ? codegen_1.operators.EQ : codegen_1.operators.NEQ;
    let cond;
    switch (dataType) {
      case "null":
        return (0, codegen_1._)`${data} ${EQ} null`;
      case "array":
        cond = (0, codegen_1._)`Array.isArray(${data})`;
        break;
      case "object":
        cond = (0, codegen_1._)`${data} && typeof ${data} == "object" && !Array.isArray(${data})`;
        break;
      case "integer":
        cond = numCond((0, codegen_1._)`!(${data} % 1) && !isNaN(${data})`);
        break;
      case "number":
        cond = numCond();
        break;
      default:
        return (0, codegen_1._)`typeof ${data} ${EQ} ${dataType}`;
    }
    return correct === DataType.Correct ? cond : (0, codegen_1.not)(cond);
    function numCond(_cond = codegen_1.nil) {
      return (0, codegen_1.and)((0, codegen_1._)`typeof ${data} == "number"`, _cond, strictNums ? (0, codegen_1._)`isFinite(${data})` : codegen_1.nil);
    }
  }
  exports.checkDataType = checkDataType;
  function checkDataTypes(dataTypes, data, strictNums, correct) {
    if (dataTypes.length === 1) {
      return checkDataType(dataTypes[0], data, strictNums, correct);
    }
    let cond;
    const types = (0, util_1.toHash)(dataTypes);
    if (types.array && types.object) {
      const notObj = (0, codegen_1._)`typeof ${data} != "object"`;
      cond = types.null ? notObj : (0, codegen_1._)`!${data} || ${notObj}`;
      delete types.null;
      delete types.array;
      delete types.object;
    } else {
      cond = codegen_1.nil;
    }
    if (types.number)
      delete types.integer;
    for (const t in types)
      cond = (0, codegen_1.and)(cond, checkDataType(t, data, strictNums, correct));
    return cond;
  }
  exports.checkDataTypes = checkDataTypes;
  var typeError = {
    message: ({ schema }) => `must be ${schema}`,
    params: ({ schema, schemaValue }) => typeof schema == "string" ? (0, codegen_1._)`{type: ${schema}}` : (0, codegen_1._)`{type: ${schemaValue}}`
  };
  function reportTypeError(it) {
    const cxt = getTypeErrorContext(it);
    (0, errors_1.reportError)(cxt, typeError);
  }
  exports.reportTypeError = reportTypeError;
  function getTypeErrorContext(it) {
    const { gen, data, schema } = it;
    const schemaCode = (0, util_1.schemaRefOrVal)(it, schema, "type");
    return {
      gen,
      keyword: "type",
      data,
      schema: schema.type,
      schemaCode,
      schemaValue: schemaCode,
      parentSchema: schema,
      params: {},
      it
    };
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/validate/defaults.js
var require_defaults = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.assignDefaults = undefined;
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  function assignDefaults(it, ty) {
    const { properties, items } = it.schema;
    if (ty === "object" && properties) {
      for (const key in properties) {
        assignDefault(it, key, properties[key].default);
      }
    } else if (ty === "array" && Array.isArray(items)) {
      items.forEach((sch, i) => assignDefault(it, i, sch.default));
    }
  }
  exports.assignDefaults = assignDefaults;
  function assignDefault(it, prop, defaultValue) {
    const { gen, compositeRule, data, opts } = it;
    if (defaultValue === undefined)
      return;
    const childData = (0, codegen_1._)`${data}${(0, codegen_1.getProperty)(prop)}`;
    if (compositeRule) {
      (0, util_1.checkStrictMode)(it, `default is ignored for: ${childData}`);
      return;
    }
    let condition = (0, codegen_1._)`${childData} === undefined`;
    if (opts.useDefaults === "empty") {
      condition = (0, codegen_1._)`${condition} || ${childData} === null || ${childData} === ""`;
    }
    gen.if(condition, (0, codegen_1._)`${childData} = ${(0, codegen_1.stringify)(defaultValue)}`);
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/code.js
var require_code2 = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.validateUnion = exports.validateArray = exports.usePattern = exports.callValidateCode = exports.schemaProperties = exports.allSchemaProperties = exports.noPropertyInData = exports.propertyInData = exports.isOwnProperty = exports.hasPropFunc = exports.reportMissingProp = exports.checkMissingProp = exports.checkReportMissingProp = undefined;
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  var names_1 = require_names();
  var util_2 = require_util();
  function checkReportMissingProp(cxt, prop) {
    const { gen, data, it } = cxt;
    gen.if(noPropertyInData(gen, data, prop, it.opts.ownProperties), () => {
      cxt.setParams({ missingProperty: (0, codegen_1._)`${prop}` }, true);
      cxt.error();
    });
  }
  exports.checkReportMissingProp = checkReportMissingProp;
  function checkMissingProp({ gen, data, it: { opts } }, properties, missing) {
    return (0, codegen_1.or)(...properties.map((prop) => (0, codegen_1.and)(noPropertyInData(gen, data, prop, opts.ownProperties), (0, codegen_1._)`${missing} = ${prop}`)));
  }
  exports.checkMissingProp = checkMissingProp;
  function reportMissingProp(cxt, missing) {
    cxt.setParams({ missingProperty: missing }, true);
    cxt.error();
  }
  exports.reportMissingProp = reportMissingProp;
  function hasPropFunc(gen) {
    return gen.scopeValue("func", {
      ref: Object.prototype.hasOwnProperty,
      code: (0, codegen_1._)`Object.prototype.hasOwnProperty`
    });
  }
  exports.hasPropFunc = hasPropFunc;
  function isOwnProperty(gen, data, property) {
    return (0, codegen_1._)`${hasPropFunc(gen)}.call(${data}, ${property})`;
  }
  exports.isOwnProperty = isOwnProperty;
  function propertyInData(gen, data, property, ownProperties) {
    const cond = (0, codegen_1._)`${data}${(0, codegen_1.getProperty)(property)} !== undefined`;
    return ownProperties ? (0, codegen_1._)`${cond} && ${isOwnProperty(gen, data, property)}` : cond;
  }
  exports.propertyInData = propertyInData;
  function noPropertyInData(gen, data, property, ownProperties) {
    const cond = (0, codegen_1._)`${data}${(0, codegen_1.getProperty)(property)} === undefined`;
    return ownProperties ? (0, codegen_1.or)(cond, (0, codegen_1.not)(isOwnProperty(gen, data, property))) : cond;
  }
  exports.noPropertyInData = noPropertyInData;
  function allSchemaProperties(schemaMap) {
    return schemaMap ? Object.keys(schemaMap).filter((p) => p !== "__proto__") : [];
  }
  exports.allSchemaProperties = allSchemaProperties;
  function schemaProperties(it, schemaMap) {
    return allSchemaProperties(schemaMap).filter((p) => !(0, util_1.alwaysValidSchema)(it, schemaMap[p]));
  }
  exports.schemaProperties = schemaProperties;
  function callValidateCode({ schemaCode, data, it: { gen, topSchemaRef, schemaPath, errorPath }, it }, func, context, passSchema) {
    const dataAndSchema = passSchema ? (0, codegen_1._)`${schemaCode}, ${data}, ${topSchemaRef}${schemaPath}` : data;
    const valCxt = [
      [names_1.default.instancePath, (0, codegen_1.strConcat)(names_1.default.instancePath, errorPath)],
      [names_1.default.parentData, it.parentData],
      [names_1.default.parentDataProperty, it.parentDataProperty],
      [names_1.default.rootData, names_1.default.rootData]
    ];
    if (it.opts.dynamicRef)
      valCxt.push([names_1.default.dynamicAnchors, names_1.default.dynamicAnchors]);
    const args = (0, codegen_1._)`${dataAndSchema}, ${gen.object(...valCxt)}`;
    return context !== codegen_1.nil ? (0, codegen_1._)`${func}.call(${context}, ${args})` : (0, codegen_1._)`${func}(${args})`;
  }
  exports.callValidateCode = callValidateCode;
  var newRegExp = (0, codegen_1._)`new RegExp`;
  function usePattern({ gen, it: { opts } }, pattern) {
    const u = opts.unicodeRegExp ? "u" : "";
    const { regExp } = opts.code;
    const rx = regExp(pattern, u);
    return gen.scopeValue("pattern", {
      key: rx.toString(),
      ref: rx,
      code: (0, codegen_1._)`${regExp.code === "new RegExp" ? newRegExp : (0, util_2.useFunc)(gen, regExp)}(${pattern}, ${u})`
    });
  }
  exports.usePattern = usePattern;
  function validateArray(cxt) {
    const { gen, data, keyword, it } = cxt;
    const valid = gen.name("valid");
    if (it.allErrors) {
      const validArr = gen.let("valid", true);
      validateItems(() => gen.assign(validArr, false));
      return validArr;
    }
    gen.var(valid, true);
    validateItems(() => gen.break());
    return valid;
    function validateItems(notValid) {
      const len = gen.const("len", (0, codegen_1._)`${data}.length`);
      gen.forRange("i", 0, len, (i) => {
        cxt.subschema({
          keyword,
          dataProp: i,
          dataPropType: util_1.Type.Num
        }, valid);
        gen.if((0, codegen_1.not)(valid), notValid);
      });
    }
  }
  exports.validateArray = validateArray;
  function validateUnion(cxt) {
    const { gen, schema, keyword, it } = cxt;
    if (!Array.isArray(schema))
      throw new Error("ajv implementation error");
    const alwaysValid = schema.some((sch) => (0, util_1.alwaysValidSchema)(it, sch));
    if (alwaysValid && !it.opts.unevaluated)
      return;
    const valid = gen.let("valid", false);
    const schValid = gen.name("_valid");
    gen.block(() => schema.forEach((_sch, i) => {
      const schCxt = cxt.subschema({
        keyword,
        schemaProp: i,
        compositeRule: true
      }, schValid);
      gen.assign(valid, (0, codegen_1._)`${valid} || ${schValid}`);
      const merged = cxt.mergeValidEvaluated(schCxt, schValid);
      if (!merged)
        gen.if((0, codegen_1.not)(valid));
    }));
    cxt.result(valid, () => cxt.reset(), () => cxt.error(true));
  }
  exports.validateUnion = validateUnion;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/validate/keyword.js
var require_keyword = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.validateKeywordUsage = exports.validSchemaType = exports.funcKeywordCode = exports.macroKeywordCode = undefined;
  var codegen_1 = require_codegen();
  var names_1 = require_names();
  var code_1 = require_code2();
  var errors_1 = require_errors();
  function macroKeywordCode(cxt, def) {
    const { gen, keyword, schema, parentSchema, it } = cxt;
    const macroSchema = def.macro.call(it.self, schema, parentSchema, it);
    const schemaRef = useKeyword(gen, keyword, macroSchema);
    if (it.opts.validateSchema !== false)
      it.self.validateSchema(macroSchema, true);
    const valid = gen.name("valid");
    cxt.subschema({
      schema: macroSchema,
      schemaPath: codegen_1.nil,
      errSchemaPath: `${it.errSchemaPath}/${keyword}`,
      topSchemaRef: schemaRef,
      compositeRule: true
    }, valid);
    cxt.pass(valid, () => cxt.error(true));
  }
  exports.macroKeywordCode = macroKeywordCode;
  function funcKeywordCode(cxt, def) {
    var _a;
    const { gen, keyword, schema, parentSchema, $data, it } = cxt;
    checkAsyncKeyword(it, def);
    const validate = !$data && def.compile ? def.compile.call(it.self, schema, parentSchema, it) : def.validate;
    const validateRef = useKeyword(gen, keyword, validate);
    const valid = gen.let("valid");
    cxt.block$data(valid, validateKeyword);
    cxt.ok((_a = def.valid) !== null && _a !== undefined ? _a : valid);
    function validateKeyword() {
      if (def.errors === false) {
        assignValid();
        if (def.modifying)
          modifyData(cxt);
        reportErrs(() => cxt.error());
      } else {
        const ruleErrs = def.async ? validateAsync() : validateSync();
        if (def.modifying)
          modifyData(cxt);
        reportErrs(() => addErrs(cxt, ruleErrs));
      }
    }
    function validateAsync() {
      const ruleErrs = gen.let("ruleErrs", null);
      gen.try(() => assignValid((0, codegen_1._)`await `), (e) => gen.assign(valid, false).if((0, codegen_1._)`${e} instanceof ${it.ValidationError}`, () => gen.assign(ruleErrs, (0, codegen_1._)`${e}.errors`), () => gen.throw(e)));
      return ruleErrs;
    }
    function validateSync() {
      const validateErrs = (0, codegen_1._)`${validateRef}.errors`;
      gen.assign(validateErrs, null);
      assignValid(codegen_1.nil);
      return validateErrs;
    }
    function assignValid(_await = def.async ? (0, codegen_1._)`await ` : codegen_1.nil) {
      const passCxt = it.opts.passContext ? names_1.default.this : names_1.default.self;
      const passSchema = !(("compile" in def) && !$data || def.schema === false);
      gen.assign(valid, (0, codegen_1._)`${_await}${(0, code_1.callValidateCode)(cxt, validateRef, passCxt, passSchema)}`, def.modifying);
    }
    function reportErrs(errors) {
      var _a2;
      gen.if((0, codegen_1.not)((_a2 = def.valid) !== null && _a2 !== undefined ? _a2 : valid), errors);
    }
  }
  exports.funcKeywordCode = funcKeywordCode;
  function modifyData(cxt) {
    const { gen, data, it } = cxt;
    gen.if(it.parentData, () => gen.assign(data, (0, codegen_1._)`${it.parentData}[${it.parentDataProperty}]`));
  }
  function addErrs(cxt, errs) {
    const { gen } = cxt;
    gen.if((0, codegen_1._)`Array.isArray(${errs})`, () => {
      gen.assign(names_1.default.vErrors, (0, codegen_1._)`${names_1.default.vErrors} === null ? ${errs} : ${names_1.default.vErrors}.concat(${errs})`).assign(names_1.default.errors, (0, codegen_1._)`${names_1.default.vErrors}.length`);
      (0, errors_1.extendErrors)(cxt);
    }, () => cxt.error());
  }
  function checkAsyncKeyword({ schemaEnv }, def) {
    if (def.async && !schemaEnv.$async)
      throw new Error("async keyword in sync schema");
  }
  function useKeyword(gen, keyword, result) {
    if (result === undefined)
      throw new Error(`keyword "${keyword}" failed to compile`);
    return gen.scopeValue("keyword", typeof result == "function" ? { ref: result } : { ref: result, code: (0, codegen_1.stringify)(result) });
  }
  function validSchemaType(schema, schemaType, allowUndefined = false) {
    return !schemaType.length || schemaType.some((st) => st === "array" ? Array.isArray(schema) : st === "object" ? schema && typeof schema == "object" && !Array.isArray(schema) : typeof schema == st || allowUndefined && typeof schema == "undefined");
  }
  exports.validSchemaType = validSchemaType;
  function validateKeywordUsage({ schema, opts, self, errSchemaPath }, def, keyword) {
    if (Array.isArray(def.keyword) ? !def.keyword.includes(keyword) : def.keyword !== keyword) {
      throw new Error("ajv implementation error");
    }
    const deps = def.dependencies;
    if (deps === null || deps === undefined ? undefined : deps.some((kwd) => !Object.prototype.hasOwnProperty.call(schema, kwd))) {
      throw new Error(`parent schema must have dependencies of ${keyword}: ${deps.join(",")}`);
    }
    if (def.validateSchema) {
      const valid = def.validateSchema(schema[keyword]);
      if (!valid) {
        const msg = `keyword "${keyword}" value is invalid at path "${errSchemaPath}": ` + self.errorsText(def.validateSchema.errors);
        if (opts.validateSchema === "log")
          self.logger.error(msg);
        else
          throw new Error(msg);
      }
    }
  }
  exports.validateKeywordUsage = validateKeywordUsage;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/validate/subschema.js
var require_subschema = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.extendSubschemaMode = exports.extendSubschemaData = exports.getSubschema = undefined;
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  function getSubschema(it, { keyword, schemaProp, schema, schemaPath, errSchemaPath, topSchemaRef }) {
    if (keyword !== undefined && schema !== undefined) {
      throw new Error('both "keyword" and "schema" passed, only one allowed');
    }
    if (keyword !== undefined) {
      const sch = it.schema[keyword];
      return schemaProp === undefined ? {
        schema: sch,
        schemaPath: (0, codegen_1._)`${it.schemaPath}${(0, codegen_1.getProperty)(keyword)}`,
        errSchemaPath: `${it.errSchemaPath}/${keyword}`
      } : {
        schema: sch[schemaProp],
        schemaPath: (0, codegen_1._)`${it.schemaPath}${(0, codegen_1.getProperty)(keyword)}${(0, codegen_1.getProperty)(schemaProp)}`,
        errSchemaPath: `${it.errSchemaPath}/${keyword}/${(0, util_1.escapeFragment)(schemaProp)}`
      };
    }
    if (schema !== undefined) {
      if (schemaPath === undefined || errSchemaPath === undefined || topSchemaRef === undefined) {
        throw new Error('"schemaPath", "errSchemaPath" and "topSchemaRef" are required with "schema"');
      }
      return {
        schema,
        schemaPath,
        topSchemaRef,
        errSchemaPath
      };
    }
    throw new Error('either "keyword" or "schema" must be passed');
  }
  exports.getSubschema = getSubschema;
  function extendSubschemaData(subschema, it, { dataProp, dataPropType: dpType, data, dataTypes, propertyName }) {
    if (data !== undefined && dataProp !== undefined) {
      throw new Error('both "data" and "dataProp" passed, only one allowed');
    }
    const { gen } = it;
    if (dataProp !== undefined) {
      const { errorPath, dataPathArr, opts } = it;
      const nextData = gen.let("data", (0, codegen_1._)`${it.data}${(0, codegen_1.getProperty)(dataProp)}`, true);
      dataContextProps(nextData);
      subschema.errorPath = (0, codegen_1.str)`${errorPath}${(0, util_1.getErrorPath)(dataProp, dpType, opts.jsPropertySyntax)}`;
      subschema.parentDataProperty = (0, codegen_1._)`${dataProp}`;
      subschema.dataPathArr = [...dataPathArr, subschema.parentDataProperty];
    }
    if (data !== undefined) {
      const nextData = data instanceof codegen_1.Name ? data : gen.let("data", data, true);
      dataContextProps(nextData);
      if (propertyName !== undefined)
        subschema.propertyName = propertyName;
    }
    if (dataTypes)
      subschema.dataTypes = dataTypes;
    function dataContextProps(_nextData) {
      subschema.data = _nextData;
      subschema.dataLevel = it.dataLevel + 1;
      subschema.dataTypes = [];
      it.definedProperties = new Set;
      subschema.parentData = it.data;
      subschema.dataNames = [...it.dataNames, _nextData];
    }
  }
  exports.extendSubschemaData = extendSubschemaData;
  function extendSubschemaMode(subschema, { jtdDiscriminator, jtdMetadata, compositeRule, createErrors, allErrors }) {
    if (compositeRule !== undefined)
      subschema.compositeRule = compositeRule;
    if (createErrors !== undefined)
      subschema.createErrors = createErrors;
    if (allErrors !== undefined)
      subschema.allErrors = allErrors;
    subschema.jtdDiscriminator = jtdDiscriminator;
    subschema.jtdMetadata = jtdMetadata;
  }
  exports.extendSubschemaMode = extendSubschemaMode;
});

// node_modules/.pnpm/fast-deep-equal@3.1.3/node_modules/fast-deep-equal/index.js
var require_fast_deep_equal = __commonJS((exports, module) => {
  module.exports = function equal(a, b) {
    if (a === b)
      return true;
    if (a && b && typeof a == "object" && typeof b == "object") {
      if (a.constructor !== b.constructor)
        return false;
      var length, i, keys;
      if (Array.isArray(a)) {
        length = a.length;
        if (length != b.length)
          return false;
        for (i = length;i-- !== 0; )
          if (!equal(a[i], b[i]))
            return false;
        return true;
      }
      if (a.constructor === RegExp)
        return a.source === b.source && a.flags === b.flags;
      if (a.valueOf !== Object.prototype.valueOf)
        return a.valueOf() === b.valueOf();
      if (a.toString !== Object.prototype.toString)
        return a.toString() === b.toString();
      keys = Object.keys(a);
      length = keys.length;
      if (length !== Object.keys(b).length)
        return false;
      for (i = length;i-- !== 0; )
        if (!Object.prototype.hasOwnProperty.call(b, keys[i]))
          return false;
      for (i = length;i-- !== 0; ) {
        var key = keys[i];
        if (!equal(a[key], b[key]))
          return false;
      }
      return true;
    }
    return a !== a && b !== b;
  };
});

// node_modules/.pnpm/json-schema-traverse@1.0.0/node_modules/json-schema-traverse/index.js
var require_json_schema_traverse = __commonJS((exports, module) => {
  var traverse = module.exports = function(schema, opts, cb) {
    if (typeof opts == "function") {
      cb = opts;
      opts = {};
    }
    cb = opts.cb || cb;
    var pre = typeof cb == "function" ? cb : cb.pre || function() {};
    var post = cb.post || function() {};
    _traverse(opts, pre, post, schema, "", schema);
  };
  traverse.keywords = {
    additionalItems: true,
    items: true,
    contains: true,
    additionalProperties: true,
    propertyNames: true,
    not: true,
    if: true,
    then: true,
    else: true
  };
  traverse.arrayKeywords = {
    items: true,
    allOf: true,
    anyOf: true,
    oneOf: true
  };
  traverse.propsKeywords = {
    $defs: true,
    definitions: true,
    properties: true,
    patternProperties: true,
    dependencies: true
  };
  traverse.skipKeywords = {
    default: true,
    enum: true,
    const: true,
    required: true,
    maximum: true,
    minimum: true,
    exclusiveMaximum: true,
    exclusiveMinimum: true,
    multipleOf: true,
    maxLength: true,
    minLength: true,
    pattern: true,
    format: true,
    maxItems: true,
    minItems: true,
    uniqueItems: true,
    maxProperties: true,
    minProperties: true
  };
  function _traverse(opts, pre, post, schema, jsonPtr, rootSchema, parentJsonPtr, parentKeyword, parentSchema, keyIndex) {
    if (schema && typeof schema == "object" && !Array.isArray(schema)) {
      pre(schema, jsonPtr, rootSchema, parentJsonPtr, parentKeyword, parentSchema, keyIndex);
      for (var key in schema) {
        var sch = schema[key];
        if (Array.isArray(sch)) {
          if (key in traverse.arrayKeywords) {
            for (var i = 0;i < sch.length; i++)
              _traverse(opts, pre, post, sch[i], jsonPtr + "/" + key + "/" + i, rootSchema, jsonPtr, key, schema, i);
          }
        } else if (key in traverse.propsKeywords) {
          if (sch && typeof sch == "object") {
            for (var prop in sch)
              _traverse(opts, pre, post, sch[prop], jsonPtr + "/" + key + "/" + escapeJsonPtr(prop), rootSchema, jsonPtr, key, schema, prop);
          }
        } else if (key in traverse.keywords || opts.allKeys && !(key in traverse.skipKeywords)) {
          _traverse(opts, pre, post, sch, jsonPtr + "/" + key, rootSchema, jsonPtr, key, schema);
        }
      }
      post(schema, jsonPtr, rootSchema, parentJsonPtr, parentKeyword, parentSchema, keyIndex);
    }
  }
  function escapeJsonPtr(str) {
    return str.replace(/~/g, "~0").replace(/\//g, "~1");
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/resolve.js
var require_resolve = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.getSchemaRefs = exports.resolveUrl = exports.normalizeId = exports._getFullPath = exports.getFullPath = exports.inlineRef = undefined;
  var util_1 = require_util();
  var equal = require_fast_deep_equal();
  var traverse = require_json_schema_traverse();
  var SIMPLE_INLINED = new Set([
    "type",
    "format",
    "pattern",
    "maxLength",
    "minLength",
    "maxProperties",
    "minProperties",
    "maxItems",
    "minItems",
    "maximum",
    "minimum",
    "uniqueItems",
    "multipleOf",
    "required",
    "enum",
    "const"
  ]);
  function inlineRef(schema, limit = true) {
    if (typeof schema == "boolean")
      return true;
    if (limit === true)
      return !hasRef(schema);
    if (!limit)
      return false;
    return countKeys(schema) <= limit;
  }
  exports.inlineRef = inlineRef;
  var REF_KEYWORDS = new Set([
    "$ref",
    "$recursiveRef",
    "$recursiveAnchor",
    "$dynamicRef",
    "$dynamicAnchor"
  ]);
  function hasRef(schema) {
    for (const key in schema) {
      if (REF_KEYWORDS.has(key))
        return true;
      const sch = schema[key];
      if (Array.isArray(sch) && sch.some(hasRef))
        return true;
      if (typeof sch == "object" && hasRef(sch))
        return true;
    }
    return false;
  }
  function countKeys(schema) {
    let count = 0;
    for (const key in schema) {
      if (key === "$ref")
        return Infinity;
      count++;
      if (SIMPLE_INLINED.has(key))
        continue;
      if (typeof schema[key] == "object") {
        (0, util_1.eachItem)(schema[key], (sch) => count += countKeys(sch));
      }
      if (count === Infinity)
        return Infinity;
    }
    return count;
  }
  function getFullPath(resolver, id = "", normalize) {
    if (normalize !== false)
      id = normalizeId(id);
    const p = resolver.parse(id);
    return _getFullPath(resolver, p);
  }
  exports.getFullPath = getFullPath;
  function _getFullPath(resolver, p) {
    const serialized = resolver.serialize(p);
    return serialized.split("#")[0] + "#";
  }
  exports._getFullPath = _getFullPath;
  var TRAILING_SLASH_HASH = /#\/?$/;
  function normalizeId(id) {
    return id ? id.replace(TRAILING_SLASH_HASH, "") : "";
  }
  exports.normalizeId = normalizeId;
  function resolveUrl(resolver, baseId, id) {
    id = normalizeId(id);
    return resolver.resolve(baseId, id);
  }
  exports.resolveUrl = resolveUrl;
  var ANCHOR = /^[a-z_][-a-z0-9._]*$/i;
  function getSchemaRefs(schema, baseId) {
    if (typeof schema == "boolean")
      return {};
    const { schemaId, uriResolver } = this.opts;
    const schId = normalizeId(schema[schemaId] || baseId);
    const baseIds = { "": schId };
    const pathPrefix = getFullPath(uriResolver, schId, false);
    const localRefs = {};
    const schemaRefs = new Set;
    traverse(schema, { allKeys: true }, (sch, jsonPtr, _, parentJsonPtr) => {
      if (parentJsonPtr === undefined)
        return;
      const fullPath = pathPrefix + jsonPtr;
      let innerBaseId = baseIds[parentJsonPtr];
      if (typeof sch[schemaId] == "string")
        innerBaseId = addRef.call(this, sch[schemaId]);
      addAnchor.call(this, sch.$anchor);
      addAnchor.call(this, sch.$dynamicAnchor);
      baseIds[jsonPtr] = innerBaseId;
      function addRef(ref) {
        const _resolve = this.opts.uriResolver.resolve;
        ref = normalizeId(innerBaseId ? _resolve(innerBaseId, ref) : ref);
        if (schemaRefs.has(ref))
          throw ambiguos(ref);
        schemaRefs.add(ref);
        let schOrRef = this.refs[ref];
        if (typeof schOrRef == "string")
          schOrRef = this.refs[schOrRef];
        if (typeof schOrRef == "object") {
          checkAmbiguosRef(sch, schOrRef.schema, ref);
        } else if (ref !== normalizeId(fullPath)) {
          if (ref[0] === "#") {
            checkAmbiguosRef(sch, localRefs[ref], ref);
            localRefs[ref] = sch;
          } else {
            this.refs[ref] = fullPath;
          }
        }
        return ref;
      }
      function addAnchor(anchor) {
        if (typeof anchor == "string") {
          if (!ANCHOR.test(anchor))
            throw new Error(`invalid anchor "${anchor}"`);
          addRef.call(this, `#${anchor}`);
        }
      }
    });
    return localRefs;
    function checkAmbiguosRef(sch1, sch2, ref) {
      if (sch2 !== undefined && !equal(sch1, sch2))
        throw ambiguos(ref);
    }
    function ambiguos(ref) {
      return new Error(`reference "${ref}" resolves to more than one schema`);
    }
  }
  exports.getSchemaRefs = getSchemaRefs;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/validate/index.js
var require_validate = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.getData = exports.KeywordCxt = exports.validateFunctionCode = undefined;
  var boolSchema_1 = require_boolSchema();
  var dataType_1 = require_dataType();
  var applicability_1 = require_applicability();
  var dataType_2 = require_dataType();
  var defaults_1 = require_defaults();
  var keyword_1 = require_keyword();
  var subschema_1 = require_subschema();
  var codegen_1 = require_codegen();
  var names_1 = require_names();
  var resolve_1 = require_resolve();
  var util_1 = require_util();
  var errors_1 = require_errors();
  function validateFunctionCode(it) {
    if (isSchemaObj(it)) {
      checkKeywords(it);
      if (schemaCxtHasRules(it)) {
        topSchemaObjCode(it);
        return;
      }
    }
    validateFunction(it, () => (0, boolSchema_1.topBoolOrEmptySchema)(it));
  }
  exports.validateFunctionCode = validateFunctionCode;
  function validateFunction({ gen, validateName, schema, schemaEnv, opts }, body) {
    if (opts.code.es5) {
      gen.func(validateName, (0, codegen_1._)`${names_1.default.data}, ${names_1.default.valCxt}`, schemaEnv.$async, () => {
        gen.code((0, codegen_1._)`"use strict"; ${funcSourceUrl(schema, opts)}`);
        destructureValCxtES5(gen, opts);
        gen.code(body);
      });
    } else {
      gen.func(validateName, (0, codegen_1._)`${names_1.default.data}, ${destructureValCxt(opts)}`, schemaEnv.$async, () => gen.code(funcSourceUrl(schema, opts)).code(body));
    }
  }
  function destructureValCxt(opts) {
    return (0, codegen_1._)`{${names_1.default.instancePath}="", ${names_1.default.parentData}, ${names_1.default.parentDataProperty}, ${names_1.default.rootData}=${names_1.default.data}${opts.dynamicRef ? (0, codegen_1._)`, ${names_1.default.dynamicAnchors}={}` : codegen_1.nil}}={}`;
  }
  function destructureValCxtES5(gen, opts) {
    gen.if(names_1.default.valCxt, () => {
      gen.var(names_1.default.instancePath, (0, codegen_1._)`${names_1.default.valCxt}.${names_1.default.instancePath}`);
      gen.var(names_1.default.parentData, (0, codegen_1._)`${names_1.default.valCxt}.${names_1.default.parentData}`);
      gen.var(names_1.default.parentDataProperty, (0, codegen_1._)`${names_1.default.valCxt}.${names_1.default.parentDataProperty}`);
      gen.var(names_1.default.rootData, (0, codegen_1._)`${names_1.default.valCxt}.${names_1.default.rootData}`);
      if (opts.dynamicRef)
        gen.var(names_1.default.dynamicAnchors, (0, codegen_1._)`${names_1.default.valCxt}.${names_1.default.dynamicAnchors}`);
    }, () => {
      gen.var(names_1.default.instancePath, (0, codegen_1._)`""`);
      gen.var(names_1.default.parentData, (0, codegen_1._)`undefined`);
      gen.var(names_1.default.parentDataProperty, (0, codegen_1._)`undefined`);
      gen.var(names_1.default.rootData, names_1.default.data);
      if (opts.dynamicRef)
        gen.var(names_1.default.dynamicAnchors, (0, codegen_1._)`{}`);
    });
  }
  function topSchemaObjCode(it) {
    const { schema, opts, gen } = it;
    validateFunction(it, () => {
      if (opts.$comment && schema.$comment)
        commentKeyword(it);
      checkNoDefault(it);
      gen.let(names_1.default.vErrors, null);
      gen.let(names_1.default.errors, 0);
      if (opts.unevaluated)
        resetEvaluated(it);
      typeAndKeywords(it);
      returnResults(it);
    });
    return;
  }
  function resetEvaluated(it) {
    const { gen, validateName } = it;
    it.evaluated = gen.const("evaluated", (0, codegen_1._)`${validateName}.evaluated`);
    gen.if((0, codegen_1._)`${it.evaluated}.dynamicProps`, () => gen.assign((0, codegen_1._)`${it.evaluated}.props`, (0, codegen_1._)`undefined`));
    gen.if((0, codegen_1._)`${it.evaluated}.dynamicItems`, () => gen.assign((0, codegen_1._)`${it.evaluated}.items`, (0, codegen_1._)`undefined`));
  }
  function funcSourceUrl(schema, opts) {
    const schId = typeof schema == "object" && schema[opts.schemaId];
    return schId && (opts.code.source || opts.code.process) ? (0, codegen_1._)`/*# sourceURL=${schId} */` : codegen_1.nil;
  }
  function subschemaCode(it, valid) {
    if (isSchemaObj(it)) {
      checkKeywords(it);
      if (schemaCxtHasRules(it)) {
        subSchemaObjCode(it, valid);
        return;
      }
    }
    (0, boolSchema_1.boolOrEmptySchema)(it, valid);
  }
  function schemaCxtHasRules({ schema, self }) {
    if (typeof schema == "boolean")
      return !schema;
    for (const key in schema)
      if (self.RULES.all[key])
        return true;
    return false;
  }
  function isSchemaObj(it) {
    return typeof it.schema != "boolean";
  }
  function subSchemaObjCode(it, valid) {
    const { schema, gen, opts } = it;
    if (opts.$comment && schema.$comment)
      commentKeyword(it);
    updateContext(it);
    checkAsyncSchema(it);
    const errsCount = gen.const("_errs", names_1.default.errors);
    typeAndKeywords(it, errsCount);
    gen.var(valid, (0, codegen_1._)`${errsCount} === ${names_1.default.errors}`);
  }
  function checkKeywords(it) {
    (0, util_1.checkUnknownRules)(it);
    checkRefsAndKeywords(it);
  }
  function typeAndKeywords(it, errsCount) {
    if (it.opts.jtd)
      return schemaKeywords(it, [], false, errsCount);
    const types = (0, dataType_1.getSchemaTypes)(it.schema);
    const checkedTypes = (0, dataType_1.coerceAndCheckDataType)(it, types);
    schemaKeywords(it, types, !checkedTypes, errsCount);
  }
  function checkRefsAndKeywords(it) {
    const { schema, errSchemaPath, opts, self } = it;
    if (schema.$ref && opts.ignoreKeywordsWithRef && (0, util_1.schemaHasRulesButRef)(schema, self.RULES)) {
      self.logger.warn(`$ref: keywords ignored in schema at path "${errSchemaPath}"`);
    }
  }
  function checkNoDefault(it) {
    const { schema, opts } = it;
    if (schema.default !== undefined && opts.useDefaults && opts.strictSchema) {
      (0, util_1.checkStrictMode)(it, "default is ignored in the schema root");
    }
  }
  function updateContext(it) {
    const schId = it.schema[it.opts.schemaId];
    if (schId)
      it.baseId = (0, resolve_1.resolveUrl)(it.opts.uriResolver, it.baseId, schId);
  }
  function checkAsyncSchema(it) {
    if (it.schema.$async && !it.schemaEnv.$async)
      throw new Error("async schema in sync schema");
  }
  function commentKeyword({ gen, schemaEnv, schema, errSchemaPath, opts }) {
    const msg = schema.$comment;
    if (opts.$comment === true) {
      gen.code((0, codegen_1._)`${names_1.default.self}.logger.log(${msg})`);
    } else if (typeof opts.$comment == "function") {
      const schemaPath = (0, codegen_1.str)`${errSchemaPath}/$comment`;
      const rootName = gen.scopeValue("root", { ref: schemaEnv.root });
      gen.code((0, codegen_1._)`${names_1.default.self}.opts.$comment(${msg}, ${schemaPath}, ${rootName}.schema)`);
    }
  }
  function returnResults(it) {
    const { gen, schemaEnv, validateName, ValidationError, opts } = it;
    if (schemaEnv.$async) {
      gen.if((0, codegen_1._)`${names_1.default.errors} === 0`, () => gen.return(names_1.default.data), () => gen.throw((0, codegen_1._)`new ${ValidationError}(${names_1.default.vErrors})`));
    } else {
      gen.assign((0, codegen_1._)`${validateName}.errors`, names_1.default.vErrors);
      if (opts.unevaluated)
        assignEvaluated(it);
      gen.return((0, codegen_1._)`${names_1.default.errors} === 0`);
    }
  }
  function assignEvaluated({ gen, evaluated, props, items }) {
    if (props instanceof codegen_1.Name)
      gen.assign((0, codegen_1._)`${evaluated}.props`, props);
    if (items instanceof codegen_1.Name)
      gen.assign((0, codegen_1._)`${evaluated}.items`, items);
  }
  function schemaKeywords(it, types, typeErrors, errsCount) {
    const { gen, schema, data, allErrors, opts, self } = it;
    const { RULES } = self;
    if (schema.$ref && (opts.ignoreKeywordsWithRef || !(0, util_1.schemaHasRulesButRef)(schema, RULES))) {
      gen.block(() => keywordCode(it, "$ref", RULES.all.$ref.definition));
      return;
    }
    if (!opts.jtd)
      checkStrictTypes(it, types);
    gen.block(() => {
      for (const group of RULES.rules)
        groupKeywords(group);
      groupKeywords(RULES.post);
    });
    function groupKeywords(group) {
      if (!(0, applicability_1.shouldUseGroup)(schema, group))
        return;
      if (group.type) {
        gen.if((0, dataType_2.checkDataType)(group.type, data, opts.strictNumbers));
        iterateKeywords(it, group);
        if (types.length === 1 && types[0] === group.type && typeErrors) {
          gen.else();
          (0, dataType_2.reportTypeError)(it);
        }
        gen.endIf();
      } else {
        iterateKeywords(it, group);
      }
      if (!allErrors)
        gen.if((0, codegen_1._)`${names_1.default.errors} === ${errsCount || 0}`);
    }
  }
  function iterateKeywords(it, group) {
    const { gen, schema, opts: { useDefaults } } = it;
    if (useDefaults)
      (0, defaults_1.assignDefaults)(it, group.type);
    gen.block(() => {
      for (const rule of group.rules) {
        if ((0, applicability_1.shouldUseRule)(schema, rule)) {
          keywordCode(it, rule.keyword, rule.definition, group.type);
        }
      }
    });
  }
  function checkStrictTypes(it, types) {
    if (it.schemaEnv.meta || !it.opts.strictTypes)
      return;
    checkContextTypes(it, types);
    if (!it.opts.allowUnionTypes)
      checkMultipleTypes(it, types);
    checkKeywordTypes(it, it.dataTypes);
  }
  function checkContextTypes(it, types) {
    if (!types.length)
      return;
    if (!it.dataTypes.length) {
      it.dataTypes = types;
      return;
    }
    types.forEach((t) => {
      if (!includesType(it.dataTypes, t)) {
        strictTypesError(it, `type "${t}" not allowed by context "${it.dataTypes.join(",")}"`);
      }
    });
    narrowSchemaTypes(it, types);
  }
  function checkMultipleTypes(it, ts) {
    if (ts.length > 1 && !(ts.length === 2 && ts.includes("null"))) {
      strictTypesError(it, "use allowUnionTypes to allow union type keyword");
    }
  }
  function checkKeywordTypes(it, ts) {
    const rules = it.self.RULES.all;
    for (const keyword in rules) {
      const rule = rules[keyword];
      if (typeof rule == "object" && (0, applicability_1.shouldUseRule)(it.schema, rule)) {
        const { type } = rule.definition;
        if (type.length && !type.some((t) => hasApplicableType(ts, t))) {
          strictTypesError(it, `missing type "${type.join(",")}" for keyword "${keyword}"`);
        }
      }
    }
  }
  function hasApplicableType(schTs, kwdT) {
    return schTs.includes(kwdT) || kwdT === "number" && schTs.includes("integer");
  }
  function includesType(ts, t) {
    return ts.includes(t) || t === "integer" && ts.includes("number");
  }
  function narrowSchemaTypes(it, withTypes) {
    const ts = [];
    for (const t of it.dataTypes) {
      if (includesType(withTypes, t))
        ts.push(t);
      else if (withTypes.includes("integer") && t === "number")
        ts.push("integer");
    }
    it.dataTypes = ts;
  }
  function strictTypesError(it, msg) {
    const schemaPath = it.schemaEnv.baseId + it.errSchemaPath;
    msg += ` at "${schemaPath}" (strictTypes)`;
    (0, util_1.checkStrictMode)(it, msg, it.opts.strictTypes);
  }

  class KeywordCxt {
    constructor(it, def, keyword) {
      (0, keyword_1.validateKeywordUsage)(it, def, keyword);
      this.gen = it.gen;
      this.allErrors = it.allErrors;
      this.keyword = keyword;
      this.data = it.data;
      this.schema = it.schema[keyword];
      this.$data = def.$data && it.opts.$data && this.schema && this.schema.$data;
      this.schemaValue = (0, util_1.schemaRefOrVal)(it, this.schema, keyword, this.$data);
      this.schemaType = def.schemaType;
      this.parentSchema = it.schema;
      this.params = {};
      this.it = it;
      this.def = def;
      if (this.$data) {
        this.schemaCode = it.gen.const("vSchema", getData(this.$data, it));
      } else {
        this.schemaCode = this.schemaValue;
        if (!(0, keyword_1.validSchemaType)(this.schema, def.schemaType, def.allowUndefined)) {
          throw new Error(`${keyword} value must be ${JSON.stringify(def.schemaType)}`);
        }
      }
      if ("code" in def ? def.trackErrors : def.errors !== false) {
        this.errsCount = it.gen.const("_errs", names_1.default.errors);
      }
    }
    result(condition, successAction, failAction) {
      this.failResult((0, codegen_1.not)(condition), successAction, failAction);
    }
    failResult(condition, successAction, failAction) {
      this.gen.if(condition);
      if (failAction)
        failAction();
      else
        this.error();
      if (successAction) {
        this.gen.else();
        successAction();
        if (this.allErrors)
          this.gen.endIf();
      } else {
        if (this.allErrors)
          this.gen.endIf();
        else
          this.gen.else();
      }
    }
    pass(condition, failAction) {
      this.failResult((0, codegen_1.not)(condition), undefined, failAction);
    }
    fail(condition) {
      if (condition === undefined) {
        this.error();
        if (!this.allErrors)
          this.gen.if(false);
        return;
      }
      this.gen.if(condition);
      this.error();
      if (this.allErrors)
        this.gen.endIf();
      else
        this.gen.else();
    }
    fail$data(condition) {
      if (!this.$data)
        return this.fail(condition);
      const { schemaCode } = this;
      this.fail((0, codegen_1._)`${schemaCode} !== undefined && (${(0, codegen_1.or)(this.invalid$data(), condition)})`);
    }
    error(append, errorParams, errorPaths) {
      if (errorParams) {
        this.setParams(errorParams);
        this._error(append, errorPaths);
        this.setParams({});
        return;
      }
      this._error(append, errorPaths);
    }
    _error(append, errorPaths) {
      (append ? errors_1.reportExtraError : errors_1.reportError)(this, this.def.error, errorPaths);
    }
    $dataError() {
      (0, errors_1.reportError)(this, this.def.$dataError || errors_1.keyword$DataError);
    }
    reset() {
      if (this.errsCount === undefined)
        throw new Error('add "trackErrors" to keyword definition');
      (0, errors_1.resetErrorsCount)(this.gen, this.errsCount);
    }
    ok(cond) {
      if (!this.allErrors)
        this.gen.if(cond);
    }
    setParams(obj, assign) {
      if (assign)
        Object.assign(this.params, obj);
      else
        this.params = obj;
    }
    block$data(valid, codeBlock, $dataValid = codegen_1.nil) {
      this.gen.block(() => {
        this.check$data(valid, $dataValid);
        codeBlock();
      });
    }
    check$data(valid = codegen_1.nil, $dataValid = codegen_1.nil) {
      if (!this.$data)
        return;
      const { gen, schemaCode, schemaType, def } = this;
      gen.if((0, codegen_1.or)((0, codegen_1._)`${schemaCode} === undefined`, $dataValid));
      if (valid !== codegen_1.nil)
        gen.assign(valid, true);
      if (schemaType.length || def.validateSchema) {
        gen.elseIf(this.invalid$data());
        this.$dataError();
        if (valid !== codegen_1.nil)
          gen.assign(valid, false);
      }
      gen.else();
    }
    invalid$data() {
      const { gen, schemaCode, schemaType, def, it } = this;
      return (0, codegen_1.or)(wrong$DataType(), invalid$DataSchema());
      function wrong$DataType() {
        if (schemaType.length) {
          if (!(schemaCode instanceof codegen_1.Name))
            throw new Error("ajv implementation error");
          const st = Array.isArray(schemaType) ? schemaType : [schemaType];
          return (0, codegen_1._)`${(0, dataType_2.checkDataTypes)(st, schemaCode, it.opts.strictNumbers, dataType_2.DataType.Wrong)}`;
        }
        return codegen_1.nil;
      }
      function invalid$DataSchema() {
        if (def.validateSchema) {
          const validateSchemaRef = gen.scopeValue("validate$data", { ref: def.validateSchema });
          return (0, codegen_1._)`!${validateSchemaRef}(${schemaCode})`;
        }
        return codegen_1.nil;
      }
    }
    subschema(appl, valid) {
      const subschema = (0, subschema_1.getSubschema)(this.it, appl);
      (0, subschema_1.extendSubschemaData)(subschema, this.it, appl);
      (0, subschema_1.extendSubschemaMode)(subschema, appl);
      const nextContext = { ...this.it, ...subschema, items: undefined, props: undefined };
      subschemaCode(nextContext, valid);
      return nextContext;
    }
    mergeEvaluated(schemaCxt, toName) {
      const { it, gen } = this;
      if (!it.opts.unevaluated)
        return;
      if (it.props !== true && schemaCxt.props !== undefined) {
        it.props = util_1.mergeEvaluated.props(gen, schemaCxt.props, it.props, toName);
      }
      if (it.items !== true && schemaCxt.items !== undefined) {
        it.items = util_1.mergeEvaluated.items(gen, schemaCxt.items, it.items, toName);
      }
    }
    mergeValidEvaluated(schemaCxt, valid) {
      const { it, gen } = this;
      if (it.opts.unevaluated && (it.props !== true || it.items !== true)) {
        gen.if(valid, () => this.mergeEvaluated(schemaCxt, codegen_1.Name));
        return true;
      }
    }
  }
  exports.KeywordCxt = KeywordCxt;
  function keywordCode(it, keyword, def, ruleType) {
    const cxt = new KeywordCxt(it, def, keyword);
    if ("code" in def) {
      def.code(cxt, ruleType);
    } else if (cxt.$data && def.validate) {
      (0, keyword_1.funcKeywordCode)(cxt, def);
    } else if ("macro" in def) {
      (0, keyword_1.macroKeywordCode)(cxt, def);
    } else if (def.compile || def.validate) {
      (0, keyword_1.funcKeywordCode)(cxt, def);
    }
  }
  var JSON_POINTER = /^\/(?:[^~]|~0|~1)*$/;
  var RELATIVE_JSON_POINTER = /^([0-9]+)(#|\/(?:[^~]|~0|~1)*)?$/;
  function getData($data, { dataLevel, dataNames, dataPathArr }) {
    let jsonPointer;
    let data;
    if ($data === "")
      return names_1.default.rootData;
    if ($data[0] === "/") {
      if (!JSON_POINTER.test($data))
        throw new Error(`Invalid JSON-pointer: ${$data}`);
      jsonPointer = $data;
      data = names_1.default.rootData;
    } else {
      const matches = RELATIVE_JSON_POINTER.exec($data);
      if (!matches)
        throw new Error(`Invalid JSON-pointer: ${$data}`);
      const up = +matches[1];
      jsonPointer = matches[2];
      if (jsonPointer === "#") {
        if (up >= dataLevel)
          throw new Error(errorMsg("property/index", up));
        return dataPathArr[dataLevel - up];
      }
      if (up > dataLevel)
        throw new Error(errorMsg("data", up));
      data = dataNames[dataLevel - up];
      if (!jsonPointer)
        return data;
    }
    let expr = data;
    const segments = jsonPointer.split("/");
    for (const segment of segments) {
      if (segment) {
        data = (0, codegen_1._)`${data}${(0, codegen_1.getProperty)((0, util_1.unescapeJsonPointer)(segment))}`;
        expr = (0, codegen_1._)`${expr} && ${data}`;
      }
    }
    return expr;
    function errorMsg(pointerType, up) {
      return `Cannot access ${pointerType} ${up} levels up, current level is ${dataLevel}`;
    }
  }
  exports.getData = getData;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/runtime/validation_error.js
var require_validation_error = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });

  class ValidationError extends Error {
    constructor(errors) {
      super("validation failed");
      this.errors = errors;
      this.ajv = this.validation = true;
    }
  }
  exports.default = ValidationError;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/ref_error.js
var require_ref_error = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var resolve_1 = require_resolve();

  class MissingRefError extends Error {
    constructor(resolver, baseId, ref, msg) {
      super(msg || `can't resolve reference ${ref} from id ${baseId}`);
      this.missingRef = (0, resolve_1.resolveUrl)(resolver, baseId, ref);
      this.missingSchema = (0, resolve_1.normalizeId)((0, resolve_1.getFullPath)(resolver, this.missingRef));
    }
  }
  exports.default = MissingRefError;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/index.js
var require_compile = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.resolveSchema = exports.getCompilingSchema = exports.resolveRef = exports.compileSchema = exports.SchemaEnv = undefined;
  var codegen_1 = require_codegen();
  var validation_error_1 = require_validation_error();
  var names_1 = require_names();
  var resolve_1 = require_resolve();
  var util_1 = require_util();
  var validate_1 = require_validate();

  class SchemaEnv {
    constructor(env) {
      var _a;
      this.refs = {};
      this.dynamicAnchors = {};
      let schema;
      if (typeof env.schema == "object")
        schema = env.schema;
      this.schema = env.schema;
      this.schemaId = env.schemaId;
      this.root = env.root || this;
      this.baseId = (_a = env.baseId) !== null && _a !== undefined ? _a : (0, resolve_1.normalizeId)(schema === null || schema === undefined ? undefined : schema[env.schemaId || "$id"]);
      this.schemaPath = env.schemaPath;
      this.localRefs = env.localRefs;
      this.meta = env.meta;
      this.$async = schema === null || schema === undefined ? undefined : schema.$async;
      this.refs = {};
    }
  }
  exports.SchemaEnv = SchemaEnv;
  function compileSchema(sch) {
    const _sch = getCompilingSchema.call(this, sch);
    if (_sch)
      return _sch;
    const rootId = (0, resolve_1.getFullPath)(this.opts.uriResolver, sch.root.baseId);
    const { es5, lines } = this.opts.code;
    const { ownProperties } = this.opts;
    const gen = new codegen_1.CodeGen(this.scope, { es5, lines, ownProperties });
    let _ValidationError;
    if (sch.$async) {
      _ValidationError = gen.scopeValue("Error", {
        ref: validation_error_1.default,
        code: (0, codegen_1._)`require("ajv/dist/runtime/validation_error").default`
      });
    }
    const validateName = gen.scopeName("validate");
    sch.validateName = validateName;
    const schemaCxt = {
      gen,
      allErrors: this.opts.allErrors,
      data: names_1.default.data,
      parentData: names_1.default.parentData,
      parentDataProperty: names_1.default.parentDataProperty,
      dataNames: [names_1.default.data],
      dataPathArr: [codegen_1.nil],
      dataLevel: 0,
      dataTypes: [],
      definedProperties: new Set,
      topSchemaRef: gen.scopeValue("schema", this.opts.code.source === true ? { ref: sch.schema, code: (0, codegen_1.stringify)(sch.schema) } : { ref: sch.schema }),
      validateName,
      ValidationError: _ValidationError,
      schema: sch.schema,
      schemaEnv: sch,
      rootId,
      baseId: sch.baseId || rootId,
      schemaPath: codegen_1.nil,
      errSchemaPath: sch.schemaPath || (this.opts.jtd ? "" : "#"),
      errorPath: (0, codegen_1._)`""`,
      opts: this.opts,
      self: this
    };
    let sourceCode;
    try {
      this._compilations.add(sch);
      (0, validate_1.validateFunctionCode)(schemaCxt);
      gen.optimize(this.opts.code.optimize);
      const validateCode = gen.toString();
      sourceCode = `${gen.scopeRefs(names_1.default.scope)}return ${validateCode}`;
      if (this.opts.code.process)
        sourceCode = this.opts.code.process(sourceCode, sch);
      const makeValidate = new Function(`${names_1.default.self}`, `${names_1.default.scope}`, sourceCode);
      const validate = makeValidate(this, this.scope.get());
      this.scope.value(validateName, { ref: validate });
      validate.errors = null;
      validate.schema = sch.schema;
      validate.schemaEnv = sch;
      if (sch.$async)
        validate.$async = true;
      if (this.opts.code.source === true) {
        validate.source = { validateName, validateCode, scopeValues: gen._values };
      }
      if (this.opts.unevaluated) {
        const { props, items } = schemaCxt;
        validate.evaluated = {
          props: props instanceof codegen_1.Name ? undefined : props,
          items: items instanceof codegen_1.Name ? undefined : items,
          dynamicProps: props instanceof codegen_1.Name,
          dynamicItems: items instanceof codegen_1.Name
        };
        if (validate.source)
          validate.source.evaluated = (0, codegen_1.stringify)(validate.evaluated);
      }
      sch.validate = validate;
      return sch;
    } catch (e) {
      delete sch.validate;
      delete sch.validateName;
      if (sourceCode)
        this.logger.error("Error compiling schema, function code:", sourceCode);
      throw e;
    } finally {
      this._compilations.delete(sch);
    }
  }
  exports.compileSchema = compileSchema;
  function resolveRef(root, baseId, ref) {
    var _a;
    ref = (0, resolve_1.resolveUrl)(this.opts.uriResolver, baseId, ref);
    const schOrFunc = root.refs[ref];
    if (schOrFunc)
      return schOrFunc;
    let _sch = resolve.call(this, root, ref);
    if (_sch === undefined) {
      const schema = (_a = root.localRefs) === null || _a === undefined ? undefined : _a[ref];
      const { schemaId } = this.opts;
      if (schema)
        _sch = new SchemaEnv({ schema, schemaId, root, baseId });
    }
    if (_sch === undefined)
      return;
    return root.refs[ref] = inlineOrCompile.call(this, _sch);
  }
  exports.resolveRef = resolveRef;
  function inlineOrCompile(sch) {
    if ((0, resolve_1.inlineRef)(sch.schema, this.opts.inlineRefs))
      return sch.schema;
    return sch.validate ? sch : compileSchema.call(this, sch);
  }
  function getCompilingSchema(schEnv) {
    for (const sch of this._compilations) {
      if (sameSchemaEnv(sch, schEnv))
        return sch;
    }
  }
  exports.getCompilingSchema = getCompilingSchema;
  function sameSchemaEnv(s1, s2) {
    return s1.schema === s2.schema && s1.root === s2.root && s1.baseId === s2.baseId;
  }
  function resolve(root, ref) {
    let sch;
    while (typeof (sch = this.refs[ref]) == "string")
      ref = sch;
    return sch || this.schemas[ref] || resolveSchema.call(this, root, ref);
  }
  function resolveSchema(root, ref) {
    const p = this.opts.uriResolver.parse(ref);
    const refPath = (0, resolve_1._getFullPath)(this.opts.uriResolver, p);
    let baseId = (0, resolve_1.getFullPath)(this.opts.uriResolver, root.baseId, undefined);
    if (Object.keys(root.schema).length > 0 && refPath === baseId) {
      return getJsonPointer.call(this, p, root);
    }
    const id = (0, resolve_1.normalizeId)(refPath);
    const schOrRef = this.refs[id] || this.schemas[id];
    if (typeof schOrRef == "string") {
      const sch = resolveSchema.call(this, root, schOrRef);
      if (typeof (sch === null || sch === undefined ? undefined : sch.schema) !== "object")
        return;
      return getJsonPointer.call(this, p, sch);
    }
    if (typeof (schOrRef === null || schOrRef === undefined ? undefined : schOrRef.schema) !== "object")
      return;
    if (!schOrRef.validate)
      compileSchema.call(this, schOrRef);
    if (id === (0, resolve_1.normalizeId)(ref)) {
      const { schema } = schOrRef;
      const { schemaId } = this.opts;
      const schId = schema[schemaId];
      if (schId)
        baseId = (0, resolve_1.resolveUrl)(this.opts.uriResolver, baseId, schId);
      return new SchemaEnv({ schema, schemaId, root, baseId });
    }
    return getJsonPointer.call(this, p, schOrRef);
  }
  exports.resolveSchema = resolveSchema;
  var PREVENT_SCOPE_CHANGE = new Set([
    "properties",
    "patternProperties",
    "enum",
    "dependencies",
    "definitions"
  ]);
  function getJsonPointer(parsedRef, { baseId, schema, root }) {
    var _a;
    if (((_a = parsedRef.fragment) === null || _a === undefined ? undefined : _a[0]) !== "/")
      return;
    for (const part of parsedRef.fragment.slice(1).split("/")) {
      if (typeof schema === "boolean")
        return;
      const partSchema = schema[(0, util_1.unescapeFragment)(part)];
      if (partSchema === undefined)
        return;
      schema = partSchema;
      const schId = typeof schema === "object" && schema[this.opts.schemaId];
      if (!PREVENT_SCOPE_CHANGE.has(part) && schId) {
        baseId = (0, resolve_1.resolveUrl)(this.opts.uriResolver, baseId, schId);
      }
    }
    let env;
    if (typeof schema != "boolean" && schema.$ref && !(0, util_1.schemaHasRulesButRef)(schema, this.RULES)) {
      const $ref = (0, resolve_1.resolveUrl)(this.opts.uriResolver, baseId, schema.$ref);
      env = resolveSchema.call(this, root, $ref);
    }
    const { schemaId } = this.opts;
    env = env || new SchemaEnv({ schema, schemaId, root, baseId });
    if (env.schema !== env.root.schema)
      return env;
    return;
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/refs/data.json
var require_data = __commonJS((exports, module) => {
  module.exports = {
    $id: "https://raw.githubusercontent.com/ajv-validator/ajv/master/lib/refs/data.json#",
    description: "Meta-schema for $data reference (JSON AnySchema extension proposal)",
    type: "object",
    required: ["$data"],
    properties: {
      $data: {
        type: "string",
        anyOf: [{ format: "relative-json-pointer" }, { format: "json-pointer" }]
      }
    },
    additionalProperties: false
  };
});

// node_modules/.pnpm/fast-uri@3.1.4/node_modules/fast-uri/lib/utils.js
var require_utils = __commonJS((exports, module) => {
  var isUUID = RegExp.prototype.test.bind(/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu);
  var isIPv4 = RegExp.prototype.test.bind(/^(?:(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)$/u);
  var isHexPair = RegExp.prototype.test.bind(/^[\da-f]{2}$/iu);
  var isUnreserved = RegExp.prototype.test.bind(/^[\da-z\-._~]$/iu);
  var isPathCharacter = RegExp.prototype.test.bind(/^[\da-z\-._~!$&'()*+,;=:@/]$/iu);
  function stringArrayToHexStripped(input) {
    let acc = "";
    let code = 0;
    let i = 0;
    for (i = 0;i < input.length; i++) {
      code = input[i].charCodeAt(0);
      if (code === 48) {
        continue;
      }
      if (!(code >= 48 && code <= 57 || code >= 65 && code <= 70 || code >= 97 && code <= 102)) {
        return "";
      }
      acc += input[i];
      break;
    }
    for (i += 1;i < input.length; i++) {
      code = input[i].charCodeAt(0);
      if (!(code >= 48 && code <= 57 || code >= 65 && code <= 70 || code >= 97 && code <= 102)) {
        return "";
      }
      acc += input[i];
    }
    return acc;
  }
  var nonSimpleDomain = RegExp.prototype.test.bind(/[^!"$&'()*+,\-.;=_`a-z{}~]/u);
  function consumeIsZone(buffer) {
    buffer.length = 0;
    return true;
  }
  function consumeHextets(buffer, address, output) {
    if (buffer.length) {
      const hex = stringArrayToHexStripped(buffer);
      if (hex !== "") {
        address.push(hex);
      } else {
        output.error = true;
        return false;
      }
      buffer.length = 0;
    }
    return true;
  }
  function getIPV6(input) {
    let tokenCount = 0;
    const output = { error: false, address: "", zone: "" };
    const address = [];
    const buffer = [];
    let endipv6Encountered = false;
    let endIpv6 = false;
    let consume = consumeHextets;
    for (let i = 0;i < input.length; i++) {
      const cursor = input[i];
      if (cursor === "[" || cursor === "]") {
        continue;
      }
      if (cursor === ":") {
        if (endipv6Encountered === true) {
          endIpv6 = true;
        }
        if (!consume(buffer, address, output)) {
          break;
        }
        if (++tokenCount > 7) {
          output.error = true;
          break;
        }
        if (i > 0 && input[i - 1] === ":") {
          endipv6Encountered = true;
        }
        address.push(":");
        continue;
      } else if (cursor === "%") {
        if (!consume(buffer, address, output)) {
          break;
        }
        consume = consumeIsZone;
      } else {
        buffer.push(cursor);
        continue;
      }
    }
    if (buffer.length) {
      if (consume === consumeIsZone) {
        output.zone = buffer.join("");
      } else if (endIpv6) {
        address.push(buffer.join(""));
      } else {
        address.push(stringArrayToHexStripped(buffer));
      }
    }
    output.address = address.join("");
    return output;
  }
  function normalizeIPv6(host) {
    if (findToken(host, ":") < 2) {
      return { host, isIPV6: false };
    }
    const ipv6 = getIPV6(host);
    if (!ipv6.error) {
      let newHost = ipv6.address;
      let escapedHost = ipv6.address;
      if (ipv6.zone) {
        newHost += "%" + ipv6.zone;
        escapedHost += "%25" + ipv6.zone;
      }
      return { host: newHost, isIPV6: true, escapedHost };
    } else {
      return { host, isIPV6: false };
    }
  }
  function findToken(str, token) {
    let ind = 0;
    for (let i = 0;i < str.length; i++) {
      if (str[i] === token)
        ind++;
    }
    return ind;
  }
  function removeDotSegments(path4) {
    let input = path4;
    const output = [];
    let nextSlash = -1;
    let len = 0;
    while (len = input.length) {
      if (len === 1) {
        if (input === ".") {
          break;
        } else if (input === "/") {
          output.push("/");
          break;
        } else {
          output.push(input);
          break;
        }
      } else if (len === 2) {
        if (input[0] === ".") {
          if (input[1] === ".") {
            break;
          } else if (input[1] === "/") {
            input = input.slice(2);
            continue;
          }
        } else if (input[0] === "/") {
          if (input[1] === "." || input[1] === "/") {
            output.push("/");
            break;
          }
        }
      } else if (len === 3) {
        if (input === "/..") {
          if (output.length !== 0) {
            output.pop();
          }
          output.push("/");
          break;
        }
      }
      if (input[0] === ".") {
        if (input[1] === ".") {
          if (input[2] === "/") {
            input = input.slice(3);
            continue;
          }
        } else if (input[1] === "/") {
          input = input.slice(2);
          continue;
        }
      } else if (input[0] === "/") {
        if (input[1] === ".") {
          if (input[2] === "/") {
            input = input.slice(2);
            continue;
          } else if (input[2] === ".") {
            if (input[3] === "/") {
              input = input.slice(3);
              if (output.length !== 0) {
                output.pop();
              }
              continue;
            }
          }
        }
      }
      if ((nextSlash = input.indexOf("/", 1)) === -1) {
        output.push(input);
        break;
      } else {
        output.push(input.slice(0, nextSlash));
        input = input.slice(nextSlash);
      }
    }
    return output.join("");
  }
  var HOST_DELIMS = { "@": "%40", "/": "%2F", "?": "%3F", "#": "%23", ":": "%3A" };
  var HOST_DELIM_RE = /[@/?#:]/g;
  var HOST_DELIM_NO_COLON_RE = /[@/?#]/g;
  function reescapeHostDelimiters(host, isIP) {
    const re = isIP ? HOST_DELIM_NO_COLON_RE : HOST_DELIM_RE;
    re.lastIndex = 0;
    return host.replace(re, (ch) => HOST_DELIMS[ch]);
  }
  function normalizePercentEncoding(input, decodeUnreserved = false) {
    if (input.indexOf("%") === -1) {
      return input;
    }
    let output = "";
    for (let i = 0;i < input.length; i++) {
      if (input[i] === "%" && i + 2 < input.length) {
        const hex = input.slice(i + 1, i + 3);
        if (isHexPair(hex)) {
          const normalizedHex = hex.toUpperCase();
          const decoded = String.fromCharCode(parseInt(normalizedHex, 16));
          if (decodeUnreserved && isUnreserved(decoded)) {
            output += decoded;
          } else {
            output += "%" + normalizedHex;
          }
          i += 2;
          continue;
        }
      }
      output += input[i];
    }
    return output;
  }
  function normalizePathEncoding(input) {
    let output = "";
    for (let i = 0;i < input.length; i++) {
      if (input[i] === "%" && i + 2 < input.length) {
        const hex = input.slice(i + 1, i + 3);
        if (isHexPair(hex)) {
          const normalizedHex = hex.toUpperCase();
          const decoded = String.fromCharCode(parseInt(normalizedHex, 16));
          if (decoded !== "." && isUnreserved(decoded)) {
            output += decoded;
          } else {
            output += "%" + normalizedHex;
          }
          i += 2;
          continue;
        }
      }
      if (isPathCharacter(input[i])) {
        output += input[i];
      } else {
        output += escape(input[i]);
      }
    }
    return output;
  }
  function escapePreservingEscapes(input) {
    let output = "";
    for (let i = 0;i < input.length; i++) {
      if (input[i] === "%" && i + 2 < input.length) {
        const hex = input.slice(i + 1, i + 3);
        if (isHexPair(hex)) {
          output += "%" + hex.toUpperCase();
          i += 2;
          continue;
        }
      }
      output += escape(input[i]);
    }
    return output;
  }
  function recomposeAuthority(component) {
    const uriTokens = [];
    if (component.userinfo !== undefined) {
      uriTokens.push(component.userinfo);
      uriTokens.push("@");
    }
    if (component.host !== undefined) {
      let host = unescape(component.host);
      if (!isIPv4(host)) {
        const ipV6res = normalizeIPv6(host);
        if (ipV6res.isIPV6 === true) {
          host = `[${ipV6res.escapedHost}]`;
        } else {
          host = reescapeHostDelimiters(host, false);
        }
      }
      uriTokens.push(host);
    }
    if (typeof component.port === "number" || typeof component.port === "string") {
      uriTokens.push(":");
      uriTokens.push(String(component.port));
    }
    return uriTokens.length ? uriTokens.join("") : undefined;
  }
  module.exports = {
    nonSimpleDomain,
    recomposeAuthority,
    reescapeHostDelimiters,
    normalizePercentEncoding,
    normalizePathEncoding,
    escapePreservingEscapes,
    removeDotSegments,
    isIPv4,
    isUUID,
    normalizeIPv6,
    stringArrayToHexStripped
  };
});

// node_modules/.pnpm/fast-uri@3.1.4/node_modules/fast-uri/lib/schemes.js
var require_schemes = __commonJS((exports, module) => {
  var { isUUID } = require_utils();
  var URN_REG = /([\da-z][\d\-a-z]{0,31}):((?:[\w!$'()*+,\-.:;=@]|%[\da-f]{2})+)/iu;
  var supportedSchemeNames = [
    "http",
    "https",
    "ws",
    "wss",
    "urn",
    "urn:uuid"
  ];
  function isValidSchemeName(name) {
    return supportedSchemeNames.indexOf(name) !== -1;
  }
  function wsIsSecure(wsComponent) {
    if (wsComponent.secure === true) {
      return true;
    } else if (wsComponent.secure === false) {
      return false;
    } else if (wsComponent.scheme) {
      return wsComponent.scheme.length === 3 && (wsComponent.scheme[0] === "w" || wsComponent.scheme[0] === "W") && (wsComponent.scheme[1] === "s" || wsComponent.scheme[1] === "S") && (wsComponent.scheme[2] === "s" || wsComponent.scheme[2] === "S");
    } else {
      return false;
    }
  }
  function httpParse(component) {
    if (!component.host) {
      component.error = component.error || "HTTP URIs must have a host.";
    }
    return component;
  }
  function httpSerialize(component) {
    const secure = String(component.scheme).toLowerCase() === "https";
    if (component.port === (secure ? 443 : 80) || component.port === "") {
      component.port = undefined;
    }
    if (!component.path) {
      component.path = "/";
    }
    return component;
  }
  function wsParse(wsComponent) {
    wsComponent.secure = wsIsSecure(wsComponent);
    wsComponent.resourceName = (wsComponent.path || "/") + (wsComponent.query ? "?" + wsComponent.query : "");
    wsComponent.path = undefined;
    wsComponent.query = undefined;
    return wsComponent;
  }
  function wsSerialize(wsComponent) {
    if (wsComponent.port === (wsIsSecure(wsComponent) ? 443 : 80) || wsComponent.port === "") {
      wsComponent.port = undefined;
    }
    if (typeof wsComponent.secure === "boolean") {
      wsComponent.scheme = wsComponent.secure ? "wss" : "ws";
      wsComponent.secure = undefined;
    }
    if (wsComponent.resourceName) {
      const [path4, query] = wsComponent.resourceName.split("?");
      wsComponent.path = path4 && path4 !== "/" ? path4 : undefined;
      wsComponent.query = query;
      wsComponent.resourceName = undefined;
    }
    wsComponent.fragment = undefined;
    return wsComponent;
  }
  function urnParse(urnComponent, options) {
    if (!urnComponent.path) {
      urnComponent.error = "URN can not be parsed";
      return urnComponent;
    }
    const matches = urnComponent.path.match(URN_REG);
    if (matches) {
      const scheme = options.scheme || urnComponent.scheme || "urn";
      urnComponent.nid = matches[1].toLowerCase();
      urnComponent.nss = matches[2];
      const urnScheme = `${scheme}:${options.nid || urnComponent.nid}`;
      const schemeHandler = getSchemeHandler(urnScheme);
      urnComponent.path = undefined;
      if (schemeHandler) {
        urnComponent = schemeHandler.parse(urnComponent, options);
      }
    } else {
      urnComponent.error = urnComponent.error || "URN can not be parsed.";
    }
    return urnComponent;
  }
  function urnSerialize(urnComponent, options) {
    if (urnComponent.nid === undefined) {
      throw new Error("URN without nid cannot be serialized");
    }
    const scheme = options.scheme || urnComponent.scheme || "urn";
    const nid = urnComponent.nid.toLowerCase();
    const urnScheme = `${scheme}:${options.nid || nid}`;
    const schemeHandler = getSchemeHandler(urnScheme);
    if (schemeHandler) {
      urnComponent = schemeHandler.serialize(urnComponent, options);
    }
    const uriComponent = urnComponent;
    const nss = urnComponent.nss;
    uriComponent.path = `${nid || options.nid}:${nss}`;
    options.skipEscape = true;
    return uriComponent;
  }
  function urnuuidParse(urnComponent, options) {
    const uuidComponent = urnComponent;
    uuidComponent.uuid = uuidComponent.nss;
    uuidComponent.nss = undefined;
    if (!options.tolerant && (!uuidComponent.uuid || !isUUID(uuidComponent.uuid))) {
      uuidComponent.error = uuidComponent.error || "UUID is not valid.";
    }
    return uuidComponent;
  }
  function urnuuidSerialize(uuidComponent) {
    const urnComponent = uuidComponent;
    urnComponent.nss = (uuidComponent.uuid || "").toLowerCase();
    return urnComponent;
  }
  var http = {
    scheme: "http",
    domainHost: true,
    parse: httpParse,
    serialize: httpSerialize
  };
  var https = {
    scheme: "https",
    domainHost: http.domainHost,
    parse: httpParse,
    serialize: httpSerialize
  };
  var ws = {
    scheme: "ws",
    domainHost: true,
    parse: wsParse,
    serialize: wsSerialize
  };
  var wss = {
    scheme: "wss",
    domainHost: ws.domainHost,
    parse: ws.parse,
    serialize: ws.serialize
  };
  var urn = {
    scheme: "urn",
    parse: urnParse,
    serialize: urnSerialize,
    skipNormalize: true
  };
  var urnuuid = {
    scheme: "urn:uuid",
    parse: urnuuidParse,
    serialize: urnuuidSerialize,
    skipNormalize: true
  };
  var SCHEMES = {
    http,
    https,
    ws,
    wss,
    urn,
    "urn:uuid": urnuuid
  };
  Object.setPrototypeOf(SCHEMES, null);
  function getSchemeHandler(scheme) {
    return scheme && (SCHEMES[scheme] || SCHEMES[scheme.toLowerCase()]) || undefined;
  }
  module.exports = {
    wsIsSecure,
    SCHEMES,
    isValidSchemeName,
    getSchemeHandler
  };
});

// node_modules/.pnpm/fast-uri@3.1.4/node_modules/fast-uri/index.js
var require_fast_uri = __commonJS((exports, module) => {
  var { normalizeIPv6, removeDotSegments, recomposeAuthority, normalizePercentEncoding, normalizePathEncoding, escapePreservingEscapes, reescapeHostDelimiters, isIPv4, nonSimpleDomain } = require_utils();
  var { SCHEMES, getSchemeHandler } = require_schemes();
  function normalize(uri, options) {
    if (typeof uri === "string") {
      uri = normalizeString(uri, options);
    } else if (typeof uri === "object") {
      uri = parse(serialize(uri, options), options);
    }
    return uri;
  }
  function resolve(baseURI, relativeURI, options) {
    const schemelessOptions = options ? Object.assign({ scheme: "null" }, options) : { scheme: "null" };
    const resolved = resolveComponent(parse(baseURI, schemelessOptions), parse(relativeURI, schemelessOptions), schemelessOptions, true);
    schemelessOptions.skipEscape = true;
    return serialize(resolved, schemelessOptions);
  }
  function resolveComponent(base, relative, options, skipNormalization) {
    const target = {};
    if (!skipNormalization) {
      base = parse(serialize(base, options), options);
      relative = parse(serialize(relative, options), options);
    }
    options = options || {};
    if (!options.tolerant && relative.scheme) {
      target.scheme = relative.scheme;
      target.userinfo = relative.userinfo;
      target.host = relative.host;
      target.port = relative.port;
      target.path = removeDotSegments(relative.path || "");
      target.query = relative.query;
    } else {
      if (relative.userinfo !== undefined || relative.host !== undefined || relative.port !== undefined) {
        target.userinfo = relative.userinfo;
        target.host = relative.host;
        target.port = relative.port;
        target.path = removeDotSegments(relative.path || "");
        target.query = relative.query;
      } else {
        if (!relative.path) {
          target.path = base.path;
          if (relative.query !== undefined) {
            target.query = relative.query;
          } else {
            target.query = base.query;
          }
        } else {
          if (relative.path[0] === "/") {
            target.path = removeDotSegments(relative.path);
          } else {
            if ((base.userinfo !== undefined || base.host !== undefined || base.port !== undefined) && !base.path) {
              target.path = "/" + relative.path;
            } else if (!base.path) {
              target.path = relative.path;
            } else {
              target.path = base.path.slice(0, base.path.lastIndexOf("/") + 1) + relative.path;
            }
            target.path = removeDotSegments(target.path);
          }
          target.query = relative.query;
        }
        target.userinfo = base.userinfo;
        target.host = base.host;
        target.port = base.port;
      }
      target.scheme = base.scheme;
    }
    target.fragment = relative.fragment;
    return target;
  }
  function equal(uriA, uriB, options) {
    const normalizedA = normalizeComparableURI(uriA, options);
    const normalizedB = normalizeComparableURI(uriB, options);
    return normalizedA !== undefined && normalizedB !== undefined && normalizedA.toLowerCase() === normalizedB.toLowerCase();
  }
  function serialize(cmpts, opts) {
    const component = {
      host: cmpts.host,
      scheme: cmpts.scheme,
      userinfo: cmpts.userinfo,
      port: cmpts.port,
      path: cmpts.path,
      query: cmpts.query,
      nid: cmpts.nid,
      nss: cmpts.nss,
      uuid: cmpts.uuid,
      fragment: cmpts.fragment,
      reference: cmpts.reference,
      resourceName: cmpts.resourceName,
      secure: cmpts.secure,
      error: ""
    };
    const options = Object.assign({}, opts);
    const uriTokens = [];
    const schemeHandler = getSchemeHandler(options.scheme || component.scheme);
    if (schemeHandler && schemeHandler.serialize)
      schemeHandler.serialize(component, options);
    if (component.path !== undefined) {
      if (!options.skipEscape) {
        component.path = escapePreservingEscapes(component.path);
        if (component.scheme !== undefined) {
          component.path = component.path.split("%3A").join(":");
        }
      } else {
        component.path = normalizePercentEncoding(component.path);
      }
    }
    if (options.reference !== "suffix" && component.scheme) {
      uriTokens.push(component.scheme, ":");
    }
    const authority = recomposeAuthority(component);
    if (authority !== undefined) {
      if (options.reference !== "suffix") {
        uriTokens.push("//");
      }
      uriTokens.push(authority);
      if (component.path && component.path[0] !== "/") {
        uriTokens.push("/");
      }
    }
    if (component.path !== undefined) {
      let s = component.path;
      if (!options.absolutePath && (!schemeHandler || !schemeHandler.absolutePath)) {
        s = removeDotSegments(s);
      }
      if (authority === undefined && s[0] === "/" && s[1] === "/") {
        s = "/%2F" + s.slice(2);
      }
      uriTokens.push(s);
    }
    if (component.query !== undefined) {
      uriTokens.push("?", component.query);
    }
    if (component.fragment !== undefined) {
      uriTokens.push("#", component.fragment);
    }
    return uriTokens.join("");
  }
  var URI_PARSE = /^(?:([^#/:?]+):)?(?:\/\/((?:([^#/?@]*)@)?(\[[^#/?\]]+\]|[^#/:?]*)(?::(\d*))?))?([^#?]*)(?:\?([^#]*))?(?:#((?:.|[\n\r])*))?/u;
  var AUTHORITY_PREFIX = /^(?:[^#/:?]+:)?\/\/([^/?#]*)/;
  function getParseError(parsed, matches) {
    if (matches[2] !== undefined && parsed.path && parsed.path[0] !== "/") {
      return 'URI path must start with "/" when authority is present.';
    }
    if (typeof parsed.port === "number" && (parsed.port < 0 || parsed.port > 65535)) {
      return "URI port is malformed.";
    }
    return;
  }
  function parseWithStatus(uri, opts) {
    const options = Object.assign({}, opts);
    const parsed = {
      scheme: undefined,
      userinfo: undefined,
      host: "",
      port: undefined,
      path: "",
      query: undefined,
      fragment: undefined
    };
    let malformedAuthorityOrPort = false;
    let isIP = false;
    if (options.reference === "suffix") {
      if (options.scheme) {
        uri = options.scheme + ":" + uri;
      } else {
        uri = "//" + uri;
      }
    }
    const authorityMatch = uri.match(AUTHORITY_PREFIX);
    if (authorityMatch !== null && authorityMatch[1].indexOf("\\") !== -1) {
      parsed.error = "URI authority must not contain a literal backslash.";
      malformedAuthorityOrPort = true;
    }
    const matches = uri.match(URI_PARSE);
    if (matches) {
      parsed.scheme = matches[1];
      parsed.userinfo = matches[3];
      parsed.host = matches[4];
      parsed.port = parseInt(matches[5], 10);
      parsed.path = matches[6] || "";
      parsed.query = matches[7];
      parsed.fragment = matches[8];
      if (isNaN(parsed.port)) {
        parsed.port = matches[5];
      }
      const parseError = getParseError(parsed, matches);
      if (parseError !== undefined) {
        parsed.error = parsed.error || parseError;
        malformedAuthorityOrPort = true;
      }
      if (parsed.host) {
        const ipv4result = isIPv4(parsed.host);
        if (ipv4result === false) {
          const ipv6result = normalizeIPv6(parsed.host);
          parsed.host = ipv6result.host.toLowerCase();
          isIP = ipv6result.isIPV6;
        } else {
          isIP = true;
        }
      }
      if (parsed.scheme === undefined && parsed.userinfo === undefined && parsed.host === undefined && parsed.port === undefined && parsed.query === undefined && !parsed.path) {
        parsed.reference = "same-document";
      } else if (parsed.scheme === undefined) {
        parsed.reference = "relative";
      } else if (parsed.fragment === undefined) {
        parsed.reference = "absolute";
      } else {
        parsed.reference = "uri";
      }
      if (options.reference && options.reference !== "suffix" && options.reference !== parsed.reference) {
        parsed.error = parsed.error || "URI is not a " + options.reference + " reference.";
      }
      const schemeHandler = getSchemeHandler(options.scheme || parsed.scheme);
      if (!options.unicodeSupport && (!schemeHandler || !schemeHandler.unicodeSupport)) {
        if (parsed.host && (options.domainHost || schemeHandler && schemeHandler.domainHost) && isIP === false && nonSimpleDomain(parsed.host)) {
          try {
            parsed.host = new URL("http://" + parsed.host).hostname;
          } catch (e) {
            parsed.error = parsed.error || "Host's domain name can not be converted to ASCII: " + e;
          }
        }
      }
      if (!schemeHandler || schemeHandler && !schemeHandler.skipNormalize) {
        if (uri.indexOf("%") !== -1) {
          if (parsed.scheme !== undefined) {
            parsed.scheme = unescape(parsed.scheme);
          }
          if (parsed.host !== undefined) {
            parsed.host = reescapeHostDelimiters(unescape(parsed.host), isIP);
          }
        }
        if (parsed.path) {
          parsed.path = normalizePathEncoding(parsed.path);
        }
        if (parsed.fragment) {
          try {
            parsed.fragment = encodeURI(decodeURIComponent(parsed.fragment));
          } catch {
            parsed.error = parsed.error || "URI malformed";
          }
        }
      }
      if (schemeHandler && schemeHandler.parse) {
        schemeHandler.parse(parsed, options);
      }
    } else {
      parsed.error = parsed.error || "URI can not be parsed.";
    }
    return { parsed, malformedAuthorityOrPort };
  }
  function parse(uri, opts) {
    return parseWithStatus(uri, opts).parsed;
  }
  function normalizeString(uri, opts) {
    return normalizeStringWithStatus(uri, opts).normalized;
  }
  function normalizeStringWithStatus(uri, opts) {
    const { parsed, malformedAuthorityOrPort } = parseWithStatus(uri, opts);
    return {
      normalized: malformedAuthorityOrPort ? uri : serialize(parsed, opts),
      malformedAuthorityOrPort
    };
  }
  function normalizeComparableURI(uri, opts) {
    if (typeof uri === "string") {
      const { normalized, malformedAuthorityOrPort } = normalizeStringWithStatus(uri, opts);
      return malformedAuthorityOrPort ? undefined : normalized;
    }
    if (typeof uri === "object") {
      return serialize(uri, opts);
    }
  }
  var fastUri = {
    SCHEMES,
    normalize,
    resolve,
    resolveComponent,
    equal,
    serialize,
    parse
  };
  module.exports = fastUri;
  module.exports.default = fastUri;
  module.exports.fastUri = fastUri;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/runtime/uri.js
var require_uri = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var uri = require_fast_uri();
  uri.code = 'require("ajv/dist/runtime/uri").default';
  exports.default = uri;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/core.js
var require_core = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.CodeGen = exports.Name = exports.nil = exports.stringify = exports.str = exports._ = exports.KeywordCxt = undefined;
  var validate_1 = require_validate();
  Object.defineProperty(exports, "KeywordCxt", { enumerable: true, get: function() {
    return validate_1.KeywordCxt;
  } });
  var codegen_1 = require_codegen();
  Object.defineProperty(exports, "_", { enumerable: true, get: function() {
    return codegen_1._;
  } });
  Object.defineProperty(exports, "str", { enumerable: true, get: function() {
    return codegen_1.str;
  } });
  Object.defineProperty(exports, "stringify", { enumerable: true, get: function() {
    return codegen_1.stringify;
  } });
  Object.defineProperty(exports, "nil", { enumerable: true, get: function() {
    return codegen_1.nil;
  } });
  Object.defineProperty(exports, "Name", { enumerable: true, get: function() {
    return codegen_1.Name;
  } });
  Object.defineProperty(exports, "CodeGen", { enumerable: true, get: function() {
    return codegen_1.CodeGen;
  } });
  var validation_error_1 = require_validation_error();
  var ref_error_1 = require_ref_error();
  var rules_1 = require_rules();
  var compile_1 = require_compile();
  var codegen_2 = require_codegen();
  var resolve_1 = require_resolve();
  var dataType_1 = require_dataType();
  var util_1 = require_util();
  var $dataRefSchema = require_data();
  var uri_1 = require_uri();
  var defaultRegExp = (str, flags) => new RegExp(str, flags);
  defaultRegExp.code = "new RegExp";
  var META_IGNORE_OPTIONS = ["removeAdditional", "useDefaults", "coerceTypes"];
  var EXT_SCOPE_NAMES = new Set([
    "validate",
    "serialize",
    "parse",
    "wrapper",
    "root",
    "schema",
    "keyword",
    "pattern",
    "formats",
    "validate$data",
    "func",
    "obj",
    "Error"
  ]);
  var removedOptions = {
    errorDataPath: "",
    format: "`validateFormats: false` can be used instead.",
    nullable: '"nullable" keyword is supported by default.',
    jsonPointers: "Deprecated jsPropertySyntax can be used instead.",
    extendRefs: "Deprecated ignoreKeywordsWithRef can be used instead.",
    missingRefs: "Pass empty schema with $id that should be ignored to ajv.addSchema.",
    processCode: "Use option `code: {process: (code, schemaEnv: object) => string}`",
    sourceCode: "Use option `code: {source: true}`",
    strictDefaults: "It is default now, see option `strict`.",
    strictKeywords: "It is default now, see option `strict`.",
    uniqueItems: '"uniqueItems" keyword is always validated.',
    unknownFormats: "Disable strict mode or pass `true` to `ajv.addFormat` (or `formats` option).",
    cache: "Map is used as cache, schema object as key.",
    serialize: "Map is used as cache, schema object as key.",
    ajvErrors: "It is default now."
  };
  var deprecatedOptions = {
    ignoreKeywordsWithRef: "",
    jsPropertySyntax: "",
    unicode: '"minLength"/"maxLength" account for unicode characters by default.'
  };
  var MAX_EXPRESSION = 200;
  function requiredOptions(o) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0;
    const s = o.strict;
    const _optz = (_a = o.code) === null || _a === undefined ? undefined : _a.optimize;
    const optimize = _optz === true || _optz === undefined ? 1 : _optz || 0;
    const regExp = (_c = (_b = o.code) === null || _b === undefined ? undefined : _b.regExp) !== null && _c !== undefined ? _c : defaultRegExp;
    const uriResolver = (_d = o.uriResolver) !== null && _d !== undefined ? _d : uri_1.default;
    return {
      strictSchema: (_f = (_e = o.strictSchema) !== null && _e !== undefined ? _e : s) !== null && _f !== undefined ? _f : true,
      strictNumbers: (_h = (_g = o.strictNumbers) !== null && _g !== undefined ? _g : s) !== null && _h !== undefined ? _h : true,
      strictTypes: (_k = (_j = o.strictTypes) !== null && _j !== undefined ? _j : s) !== null && _k !== undefined ? _k : "log",
      strictTuples: (_m = (_l = o.strictTuples) !== null && _l !== undefined ? _l : s) !== null && _m !== undefined ? _m : "log",
      strictRequired: (_p = (_o = o.strictRequired) !== null && _o !== undefined ? _o : s) !== null && _p !== undefined ? _p : false,
      code: o.code ? { ...o.code, optimize, regExp } : { optimize, regExp },
      loopRequired: (_q = o.loopRequired) !== null && _q !== undefined ? _q : MAX_EXPRESSION,
      loopEnum: (_r = o.loopEnum) !== null && _r !== undefined ? _r : MAX_EXPRESSION,
      meta: (_s = o.meta) !== null && _s !== undefined ? _s : true,
      messages: (_t = o.messages) !== null && _t !== undefined ? _t : true,
      inlineRefs: (_u = o.inlineRefs) !== null && _u !== undefined ? _u : true,
      schemaId: (_v = o.schemaId) !== null && _v !== undefined ? _v : "$id",
      addUsedSchema: (_w = o.addUsedSchema) !== null && _w !== undefined ? _w : true,
      validateSchema: (_x = o.validateSchema) !== null && _x !== undefined ? _x : true,
      validateFormats: (_y = o.validateFormats) !== null && _y !== undefined ? _y : true,
      unicodeRegExp: (_z = o.unicodeRegExp) !== null && _z !== undefined ? _z : true,
      int32range: (_0 = o.int32range) !== null && _0 !== undefined ? _0 : true,
      uriResolver
    };
  }

  class Ajv {
    constructor(opts = {}) {
      this.schemas = {};
      this.refs = {};
      this.formats = Object.create(null);
      this._compilations = new Set;
      this._loading = {};
      this._cache = new Map;
      opts = this.opts = { ...opts, ...requiredOptions(opts) };
      const { es5, lines } = this.opts.code;
      this.scope = new codegen_2.ValueScope({ scope: {}, prefixes: EXT_SCOPE_NAMES, es5, lines });
      this.logger = getLogger(opts.logger);
      const formatOpt = opts.validateFormats;
      opts.validateFormats = false;
      this.RULES = (0, rules_1.getRules)();
      checkOptions.call(this, removedOptions, opts, "NOT SUPPORTED");
      checkOptions.call(this, deprecatedOptions, opts, "DEPRECATED", "warn");
      this._metaOpts = getMetaSchemaOptions.call(this);
      if (opts.formats)
        addInitialFormats.call(this);
      this._addVocabularies();
      this._addDefaultMetaSchema();
      if (opts.keywords)
        addInitialKeywords.call(this, opts.keywords);
      if (typeof opts.meta == "object")
        this.addMetaSchema(opts.meta);
      addInitialSchemas.call(this);
      opts.validateFormats = formatOpt;
    }
    _addVocabularies() {
      this.addKeyword("$async");
    }
    _addDefaultMetaSchema() {
      const { $data, meta, schemaId } = this.opts;
      let _dataRefSchema = $dataRefSchema;
      if (schemaId === "id") {
        _dataRefSchema = { ...$dataRefSchema };
        _dataRefSchema.id = _dataRefSchema.$id;
        delete _dataRefSchema.$id;
      }
      if (meta && $data)
        this.addMetaSchema(_dataRefSchema, _dataRefSchema[schemaId], false);
    }
    defaultMeta() {
      const { meta, schemaId } = this.opts;
      return this.opts.defaultMeta = typeof meta == "object" ? meta[schemaId] || meta : undefined;
    }
    validate(schemaKeyRef, data) {
      let v;
      if (typeof schemaKeyRef == "string") {
        v = this.getSchema(schemaKeyRef);
        if (!v)
          throw new Error(`no schema with key or ref "${schemaKeyRef}"`);
      } else {
        v = this.compile(schemaKeyRef);
      }
      const valid = v(data);
      if (!("$async" in v))
        this.errors = v.errors;
      return valid;
    }
    compile(schema, _meta) {
      const sch = this._addSchema(schema, _meta);
      return sch.validate || this._compileSchemaEnv(sch);
    }
    compileAsync(schema, meta) {
      if (typeof this.opts.loadSchema != "function") {
        throw new Error("options.loadSchema should be a function");
      }
      const { loadSchema } = this.opts;
      return runCompileAsync.call(this, schema, meta);
      async function runCompileAsync(_schema, _meta) {
        await loadMetaSchema.call(this, _schema.$schema);
        const sch = this._addSchema(_schema, _meta);
        return sch.validate || _compileAsync.call(this, sch);
      }
      async function loadMetaSchema($ref) {
        if ($ref && !this.getSchema($ref)) {
          await runCompileAsync.call(this, { $ref }, true);
        }
      }
      async function _compileAsync(sch) {
        try {
          return this._compileSchemaEnv(sch);
        } catch (e) {
          if (!(e instanceof ref_error_1.default))
            throw e;
          checkLoaded.call(this, e);
          await loadMissingSchema.call(this, e.missingSchema);
          return _compileAsync.call(this, sch);
        }
      }
      function checkLoaded({ missingSchema: ref, missingRef }) {
        if (this.refs[ref]) {
          throw new Error(`AnySchema ${ref} is loaded but ${missingRef} cannot be resolved`);
        }
      }
      async function loadMissingSchema(ref) {
        const _schema = await _loadSchema.call(this, ref);
        if (!this.refs[ref])
          await loadMetaSchema.call(this, _schema.$schema);
        if (!this.refs[ref])
          this.addSchema(_schema, ref, meta);
      }
      async function _loadSchema(ref) {
        const p = this._loading[ref];
        if (p)
          return p;
        try {
          return await (this._loading[ref] = loadSchema(ref));
        } finally {
          delete this._loading[ref];
        }
      }
    }
    addSchema(schema, key, _meta, _validateSchema = this.opts.validateSchema) {
      if (Array.isArray(schema)) {
        for (const sch of schema)
          this.addSchema(sch, undefined, _meta, _validateSchema);
        return this;
      }
      let id;
      if (typeof schema === "object") {
        const { schemaId } = this.opts;
        id = schema[schemaId];
        if (id !== undefined && typeof id != "string") {
          throw new Error(`schema ${schemaId} must be string`);
        }
      }
      key = (0, resolve_1.normalizeId)(key || id);
      this._checkUnique(key);
      this.schemas[key] = this._addSchema(schema, _meta, key, _validateSchema, true);
      return this;
    }
    addMetaSchema(schema, key, _validateSchema = this.opts.validateSchema) {
      this.addSchema(schema, key, true, _validateSchema);
      return this;
    }
    validateSchema(schema, throwOrLogError) {
      if (typeof schema == "boolean")
        return true;
      let $schema;
      $schema = schema.$schema;
      if ($schema !== undefined && typeof $schema != "string") {
        throw new Error("$schema must be a string");
      }
      $schema = $schema || this.opts.defaultMeta || this.defaultMeta();
      if (!$schema) {
        this.logger.warn("meta-schema not available");
        this.errors = null;
        return true;
      }
      const valid = this.validate($schema, schema);
      if (!valid && throwOrLogError) {
        const message = "schema is invalid: " + this.errorsText();
        if (this.opts.validateSchema === "log")
          this.logger.error(message);
        else
          throw new Error(message);
      }
      return valid;
    }
    getSchema(keyRef) {
      let sch;
      while (typeof (sch = getSchEnv.call(this, keyRef)) == "string")
        keyRef = sch;
      if (sch === undefined) {
        const { schemaId } = this.opts;
        const root = new compile_1.SchemaEnv({ schema: {}, schemaId });
        sch = compile_1.resolveSchema.call(this, root, keyRef);
        if (!sch)
          return;
        this.refs[keyRef] = sch;
      }
      return sch.validate || this._compileSchemaEnv(sch);
    }
    removeSchema(schemaKeyRef) {
      if (schemaKeyRef instanceof RegExp) {
        this._removeAllSchemas(this.schemas, schemaKeyRef);
        this._removeAllSchemas(this.refs, schemaKeyRef);
        return this;
      }
      switch (typeof schemaKeyRef) {
        case "undefined":
          this._removeAllSchemas(this.schemas);
          this._removeAllSchemas(this.refs);
          this._cache.clear();
          return this;
        case "string": {
          const sch = getSchEnv.call(this, schemaKeyRef);
          if (typeof sch == "object")
            this._cache.delete(sch.schema);
          delete this.schemas[schemaKeyRef];
          delete this.refs[schemaKeyRef];
          return this;
        }
        case "object": {
          const cacheKey = schemaKeyRef;
          this._cache.delete(cacheKey);
          let id = schemaKeyRef[this.opts.schemaId];
          if (id) {
            id = (0, resolve_1.normalizeId)(id);
            delete this.schemas[id];
            delete this.refs[id];
          }
          return this;
        }
        default:
          throw new Error("ajv.removeSchema: invalid parameter");
      }
    }
    addVocabulary(definitions) {
      for (const def of definitions)
        this.addKeyword(def);
      return this;
    }
    addKeyword(kwdOrDef, def) {
      let keyword;
      if (typeof kwdOrDef == "string") {
        keyword = kwdOrDef;
        if (typeof def == "object") {
          this.logger.warn("these parameters are deprecated, see docs for addKeyword");
          def.keyword = keyword;
        }
      } else if (typeof kwdOrDef == "object" && def === undefined) {
        def = kwdOrDef;
        keyword = def.keyword;
        if (Array.isArray(keyword) && !keyword.length) {
          throw new Error("addKeywords: keyword must be string or non-empty array");
        }
      } else {
        throw new Error("invalid addKeywords parameters");
      }
      checkKeyword.call(this, keyword, def);
      if (!def) {
        (0, util_1.eachItem)(keyword, (kwd) => addRule.call(this, kwd));
        return this;
      }
      keywordMetaschema.call(this, def);
      const definition = {
        ...def,
        type: (0, dataType_1.getJSONTypes)(def.type),
        schemaType: (0, dataType_1.getJSONTypes)(def.schemaType)
      };
      (0, util_1.eachItem)(keyword, definition.type.length === 0 ? (k) => addRule.call(this, k, definition) : (k) => definition.type.forEach((t) => addRule.call(this, k, definition, t)));
      return this;
    }
    getKeyword(keyword) {
      const rule = this.RULES.all[keyword];
      return typeof rule == "object" ? rule.definition : !!rule;
    }
    removeKeyword(keyword) {
      const { RULES } = this;
      delete RULES.keywords[keyword];
      delete RULES.all[keyword];
      for (const group of RULES.rules) {
        const i = group.rules.findIndex((rule) => rule.keyword === keyword);
        if (i >= 0)
          group.rules.splice(i, 1);
      }
      return this;
    }
    addFormat(name, format) {
      if (typeof format == "string")
        format = new RegExp(format);
      this.formats[name] = format;
      return this;
    }
    errorsText(errors = this.errors, { separator = ", ", dataVar = "data" } = {}) {
      if (!errors || errors.length === 0)
        return "No errors";
      return errors.map((e) => `${dataVar}${e.instancePath} ${e.message}`).reduce((text, msg) => text + separator + msg);
    }
    $dataMetaSchema(metaSchema, keywordsJsonPointers) {
      const rules = this.RULES.all;
      metaSchema = JSON.parse(JSON.stringify(metaSchema));
      for (const jsonPointer of keywordsJsonPointers) {
        const segments = jsonPointer.split("/").slice(1);
        let keywords = metaSchema;
        for (const seg of segments)
          keywords = keywords[seg];
        for (const key in rules) {
          const rule = rules[key];
          if (typeof rule != "object")
            continue;
          const { $data } = rule.definition;
          const schema = keywords[key];
          if ($data && schema)
            keywords[key] = schemaOrData(schema);
        }
      }
      return metaSchema;
    }
    _removeAllSchemas(schemas, regex) {
      for (const keyRef in schemas) {
        const sch = schemas[keyRef];
        if (!regex || regex.test(keyRef)) {
          if (typeof sch == "string") {
            delete schemas[keyRef];
          } else if (sch && !sch.meta) {
            this._cache.delete(sch.schema);
            delete schemas[keyRef];
          }
        }
      }
    }
    _addSchema(schema, meta, baseId, validateSchema = this.opts.validateSchema, addSchema = this.opts.addUsedSchema) {
      let id;
      const { schemaId } = this.opts;
      if (typeof schema == "object") {
        id = schema[schemaId];
      } else {
        if (this.opts.jtd)
          throw new Error("schema must be object");
        else if (typeof schema != "boolean")
          throw new Error("schema must be object or boolean");
      }
      let sch = this._cache.get(schema);
      if (sch !== undefined)
        return sch;
      baseId = (0, resolve_1.normalizeId)(id || baseId);
      const localRefs = resolve_1.getSchemaRefs.call(this, schema, baseId);
      sch = new compile_1.SchemaEnv({ schema, schemaId, meta, baseId, localRefs });
      this._cache.set(sch.schema, sch);
      if (addSchema && !baseId.startsWith("#")) {
        if (baseId)
          this._checkUnique(baseId);
        this.refs[baseId] = sch;
      }
      if (validateSchema)
        this.validateSchema(schema, true);
      return sch;
    }
    _checkUnique(id) {
      if (this.schemas[id] || this.refs[id]) {
        throw new Error(`schema with key or id "${id}" already exists`);
      }
    }
    _compileSchemaEnv(sch) {
      if (sch.meta)
        this._compileMetaSchema(sch);
      else
        compile_1.compileSchema.call(this, sch);
      if (!sch.validate)
        throw new Error("ajv implementation error");
      return sch.validate;
    }
    _compileMetaSchema(sch) {
      const currentOpts = this.opts;
      this.opts = this._metaOpts;
      try {
        compile_1.compileSchema.call(this, sch);
      } finally {
        this.opts = currentOpts;
      }
    }
  }
  Ajv.ValidationError = validation_error_1.default;
  Ajv.MissingRefError = ref_error_1.default;
  exports.default = Ajv;
  function checkOptions(checkOpts, options, msg, log = "error") {
    for (const key in checkOpts) {
      const opt = key;
      if (opt in options)
        this.logger[log](`${msg}: option ${key}. ${checkOpts[opt]}`);
    }
  }
  function getSchEnv(keyRef) {
    keyRef = (0, resolve_1.normalizeId)(keyRef);
    return this.schemas[keyRef] || this.refs[keyRef];
  }
  function addInitialSchemas() {
    const optsSchemas = this.opts.schemas;
    if (!optsSchemas)
      return;
    if (Array.isArray(optsSchemas))
      this.addSchema(optsSchemas);
    else
      for (const key in optsSchemas)
        this.addSchema(optsSchemas[key], key);
  }
  function addInitialFormats() {
    for (const name in this.opts.formats) {
      const format = this.opts.formats[name];
      if (format)
        this.addFormat(name, format);
    }
  }
  function addInitialKeywords(defs) {
    if (Array.isArray(defs)) {
      this.addVocabulary(defs);
      return;
    }
    this.logger.warn("keywords option as map is deprecated, pass array");
    for (const keyword in defs) {
      const def = defs[keyword];
      if (!def.keyword)
        def.keyword = keyword;
      this.addKeyword(def);
    }
  }
  function getMetaSchemaOptions() {
    const metaOpts = { ...this.opts };
    for (const opt of META_IGNORE_OPTIONS)
      delete metaOpts[opt];
    return metaOpts;
  }
  var noLogs = { log() {}, warn() {}, error() {} };
  function getLogger(logger) {
    if (logger === false)
      return noLogs;
    if (logger === undefined)
      return console;
    if (logger.log && logger.warn && logger.error)
      return logger;
    throw new Error("logger must implement log, warn and error methods");
  }
  var KEYWORD_NAME = /^[a-z_$][a-z0-9_$:-]*$/i;
  function checkKeyword(keyword, def) {
    const { RULES } = this;
    (0, util_1.eachItem)(keyword, (kwd) => {
      if (RULES.keywords[kwd])
        throw new Error(`Keyword ${kwd} is already defined`);
      if (!KEYWORD_NAME.test(kwd))
        throw new Error(`Keyword ${kwd} has invalid name`);
    });
    if (!def)
      return;
    if (def.$data && !(("code" in def) || ("validate" in def))) {
      throw new Error('$data keyword must have "code" or "validate" function');
    }
  }
  function addRule(keyword, definition, dataType) {
    var _a;
    const post = definition === null || definition === undefined ? undefined : definition.post;
    if (dataType && post)
      throw new Error('keyword with "post" flag cannot have "type"');
    const { RULES } = this;
    let ruleGroup = post ? RULES.post : RULES.rules.find(({ type: t }) => t === dataType);
    if (!ruleGroup) {
      ruleGroup = { type: dataType, rules: [] };
      RULES.rules.push(ruleGroup);
    }
    RULES.keywords[keyword] = true;
    if (!definition)
      return;
    const rule = {
      keyword,
      definition: {
        ...definition,
        type: (0, dataType_1.getJSONTypes)(definition.type),
        schemaType: (0, dataType_1.getJSONTypes)(definition.schemaType)
      }
    };
    if (definition.before)
      addBeforeRule.call(this, ruleGroup, rule, definition.before);
    else
      ruleGroup.rules.push(rule);
    RULES.all[keyword] = rule;
    (_a = definition.implements) === null || _a === undefined || _a.forEach((kwd) => this.addKeyword(kwd));
  }
  function addBeforeRule(ruleGroup, rule, before) {
    const i = ruleGroup.rules.findIndex((_rule) => _rule.keyword === before);
    if (i >= 0) {
      ruleGroup.rules.splice(i, 0, rule);
    } else {
      ruleGroup.rules.push(rule);
      this.logger.warn(`rule ${before} is not defined`);
    }
  }
  function keywordMetaschema(def) {
    let { metaSchema } = def;
    if (metaSchema === undefined)
      return;
    if (def.$data && this.opts.$data)
      metaSchema = schemaOrData(metaSchema);
    def.validateSchema = this.compile(metaSchema, true);
  }
  var $dataRef = {
    $ref: "https://raw.githubusercontent.com/ajv-validator/ajv/master/lib/refs/data.json#"
  };
  function schemaOrData(schema) {
    return { anyOf: [schema, $dataRef] };
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/core/id.js
var require_id = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var def = {
    keyword: "id",
    code() {
      throw new Error('NOT SUPPORTED: keyword "id", use "$id" for schema ID');
    }
  };
  exports.default = def;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/core/ref.js
var require_ref = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.callRef = exports.getValidate = undefined;
  var ref_error_1 = require_ref_error();
  var code_1 = require_code2();
  var codegen_1 = require_codegen();
  var names_1 = require_names();
  var compile_1 = require_compile();
  var util_1 = require_util();
  var def = {
    keyword: "$ref",
    schemaType: "string",
    code(cxt) {
      const { gen, schema: $ref, it } = cxt;
      const { baseId, schemaEnv: env, validateName, opts, self } = it;
      const { root } = env;
      if (($ref === "#" || $ref === "#/") && baseId === root.baseId)
        return callRootRef();
      const schOrEnv = compile_1.resolveRef.call(self, root, baseId, $ref);
      if (schOrEnv === undefined)
        throw new ref_error_1.default(it.opts.uriResolver, baseId, $ref);
      if (schOrEnv instanceof compile_1.SchemaEnv)
        return callValidate(schOrEnv);
      return inlineRefSchema(schOrEnv);
      function callRootRef() {
        if (env === root)
          return callRef(cxt, validateName, env, env.$async);
        const rootName = gen.scopeValue("root", { ref: root });
        return callRef(cxt, (0, codegen_1._)`${rootName}.validate`, root, root.$async);
      }
      function callValidate(sch) {
        const v = getValidate(cxt, sch);
        callRef(cxt, v, sch, sch.$async);
      }
      function inlineRefSchema(sch) {
        const schName = gen.scopeValue("schema", opts.code.source === true ? { ref: sch, code: (0, codegen_1.stringify)(sch) } : { ref: sch });
        const valid = gen.name("valid");
        const schCxt = cxt.subschema({
          schema: sch,
          dataTypes: [],
          schemaPath: codegen_1.nil,
          topSchemaRef: schName,
          errSchemaPath: $ref
        }, valid);
        cxt.mergeEvaluated(schCxt);
        cxt.ok(valid);
      }
    }
  };
  function getValidate(cxt, sch) {
    const { gen } = cxt;
    return sch.validate ? gen.scopeValue("validate", { ref: sch.validate }) : (0, codegen_1._)`${gen.scopeValue("wrapper", { ref: sch })}.validate`;
  }
  exports.getValidate = getValidate;
  function callRef(cxt, v, sch, $async) {
    const { gen, it } = cxt;
    const { allErrors, schemaEnv: env, opts } = it;
    const passCxt = opts.passContext ? names_1.default.this : codegen_1.nil;
    if ($async)
      callAsyncRef();
    else
      callSyncRef();
    function callAsyncRef() {
      if (!env.$async)
        throw new Error("async schema referenced by sync schema");
      const valid = gen.let("valid");
      gen.try(() => {
        gen.code((0, codegen_1._)`await ${(0, code_1.callValidateCode)(cxt, v, passCxt)}`);
        addEvaluatedFrom(v);
        if (!allErrors)
          gen.assign(valid, true);
      }, (e) => {
        gen.if((0, codegen_1._)`!(${e} instanceof ${it.ValidationError})`, () => gen.throw(e));
        addErrorsFrom(e);
        if (!allErrors)
          gen.assign(valid, false);
      });
      cxt.ok(valid);
    }
    function callSyncRef() {
      cxt.result((0, code_1.callValidateCode)(cxt, v, passCxt), () => addEvaluatedFrom(v), () => addErrorsFrom(v));
    }
    function addErrorsFrom(source) {
      const errs = (0, codegen_1._)`${source}.errors`;
      gen.assign(names_1.default.vErrors, (0, codegen_1._)`${names_1.default.vErrors} === null ? ${errs} : ${names_1.default.vErrors}.concat(${errs})`);
      gen.assign(names_1.default.errors, (0, codegen_1._)`${names_1.default.vErrors}.length`);
    }
    function addEvaluatedFrom(source) {
      var _a;
      if (!it.opts.unevaluated)
        return;
      const schEvaluated = (_a = sch === null || sch === undefined ? undefined : sch.validate) === null || _a === undefined ? undefined : _a.evaluated;
      if (it.props !== true) {
        if (schEvaluated && !schEvaluated.dynamicProps) {
          if (schEvaluated.props !== undefined) {
            it.props = util_1.mergeEvaluated.props(gen, schEvaluated.props, it.props);
          }
        } else {
          const props = gen.var("props", (0, codegen_1._)`${source}.evaluated.props`);
          it.props = util_1.mergeEvaluated.props(gen, props, it.props, codegen_1.Name);
        }
      }
      if (it.items !== true) {
        if (schEvaluated && !schEvaluated.dynamicItems) {
          if (schEvaluated.items !== undefined) {
            it.items = util_1.mergeEvaluated.items(gen, schEvaluated.items, it.items);
          }
        } else {
          const items = gen.var("items", (0, codegen_1._)`${source}.evaluated.items`);
          it.items = util_1.mergeEvaluated.items(gen, items, it.items, codegen_1.Name);
        }
      }
    }
  }
  exports.callRef = callRef;
  exports.default = def;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/core/index.js
var require_core2 = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var id_1 = require_id();
  var ref_1 = require_ref();
  var core = [
    "$schema",
    "$id",
    "$defs",
    "$vocabulary",
    { keyword: "$comment" },
    "definitions",
    id_1.default,
    ref_1.default
  ];
  exports.default = core;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/validation/limitNumber.js
var require_limitNumber = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var codegen_1 = require_codegen();
  var ops = codegen_1.operators;
  var KWDs = {
    maximum: { okStr: "<=", ok: ops.LTE, fail: ops.GT },
    minimum: { okStr: ">=", ok: ops.GTE, fail: ops.LT },
    exclusiveMaximum: { okStr: "<", ok: ops.LT, fail: ops.GTE },
    exclusiveMinimum: { okStr: ">", ok: ops.GT, fail: ops.LTE }
  };
  var error = {
    message: ({ keyword, schemaCode }) => (0, codegen_1.str)`must be ${KWDs[keyword].okStr} ${schemaCode}`,
    params: ({ keyword, schemaCode }) => (0, codegen_1._)`{comparison: ${KWDs[keyword].okStr}, limit: ${schemaCode}}`
  };
  var def = {
    keyword: Object.keys(KWDs),
    type: "number",
    schemaType: "number",
    $data: true,
    error,
    code(cxt) {
      const { keyword, data, schemaCode } = cxt;
      cxt.fail$data((0, codegen_1._)`${data} ${KWDs[keyword].fail} ${schemaCode} || isNaN(${data})`);
    }
  };
  exports.default = def;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/validation/multipleOf.js
var require_multipleOf = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var codegen_1 = require_codegen();
  var error = {
    message: ({ schemaCode }) => (0, codegen_1.str)`must be multiple of ${schemaCode}`,
    params: ({ schemaCode }) => (0, codegen_1._)`{multipleOf: ${schemaCode}}`
  };
  var def = {
    keyword: "multipleOf",
    type: "number",
    schemaType: "number",
    $data: true,
    error,
    code(cxt) {
      const { gen, data, schemaCode, it } = cxt;
      const prec = it.opts.multipleOfPrecision;
      const res = gen.let("res");
      const invalid = prec ? (0, codegen_1._)`Math.abs(Math.round(${res}) - ${res}) > 1e-${prec}` : (0, codegen_1._)`${res} !== parseInt(${res})`;
      cxt.fail$data((0, codegen_1._)`(${schemaCode} === 0 || (${res} = ${data}/${schemaCode}, ${invalid}))`);
    }
  };
  exports.default = def;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/runtime/ucs2length.js
var require_ucs2length = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  function ucs2length(str) {
    const len = str.length;
    let length = 0;
    let pos = 0;
    let value;
    while (pos < len) {
      length++;
      value = str.charCodeAt(pos++);
      if (value >= 55296 && value <= 56319 && pos < len) {
        value = str.charCodeAt(pos);
        if ((value & 64512) === 56320)
          pos++;
      }
    }
    return length;
  }
  exports.default = ucs2length;
  ucs2length.code = 'require("ajv/dist/runtime/ucs2length").default';
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/validation/limitLength.js
var require_limitLength = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  var ucs2length_1 = require_ucs2length();
  var error = {
    message({ keyword, schemaCode }) {
      const comp = keyword === "maxLength" ? "more" : "fewer";
      return (0, codegen_1.str)`must NOT have ${comp} than ${schemaCode} characters`;
    },
    params: ({ schemaCode }) => (0, codegen_1._)`{limit: ${schemaCode}}`
  };
  var def = {
    keyword: ["maxLength", "minLength"],
    type: "string",
    schemaType: "number",
    $data: true,
    error,
    code(cxt) {
      const { keyword, data, schemaCode, it } = cxt;
      const op = keyword === "maxLength" ? codegen_1.operators.GT : codegen_1.operators.LT;
      const len = it.opts.unicode === false ? (0, codegen_1._)`${data}.length` : (0, codegen_1._)`${(0, util_1.useFunc)(cxt.gen, ucs2length_1.default)}(${data})`;
      cxt.fail$data((0, codegen_1._)`${len} ${op} ${schemaCode}`);
    }
  };
  exports.default = def;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/validation/pattern.js
var require_pattern = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var code_1 = require_code2();
  var util_1 = require_util();
  var codegen_1 = require_codegen();
  var error = {
    message: ({ schemaCode }) => (0, codegen_1.str)`must match pattern "${schemaCode}"`,
    params: ({ schemaCode }) => (0, codegen_1._)`{pattern: ${schemaCode}}`
  };
  var def = {
    keyword: "pattern",
    type: "string",
    schemaType: "string",
    $data: true,
    error,
    code(cxt) {
      const { gen, data, $data, schema, schemaCode, it } = cxt;
      const u = it.opts.unicodeRegExp ? "u" : "";
      if ($data) {
        const { regExp } = it.opts.code;
        const regExpCode = regExp.code === "new RegExp" ? (0, codegen_1._)`new RegExp` : (0, util_1.useFunc)(gen, regExp);
        const valid = gen.let("valid");
        gen.try(() => gen.assign(valid, (0, codegen_1._)`${regExpCode}(${schemaCode}, ${u}).test(${data})`), () => gen.assign(valid, false));
        cxt.fail$data((0, codegen_1._)`!${valid}`);
      } else {
        const regExp = (0, code_1.usePattern)(cxt, schema);
        cxt.fail$data((0, codegen_1._)`!${regExp}.test(${data})`);
      }
    }
  };
  exports.default = def;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/validation/limitProperties.js
var require_limitProperties = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var codegen_1 = require_codegen();
  var error = {
    message({ keyword, schemaCode }) {
      const comp = keyword === "maxProperties" ? "more" : "fewer";
      return (0, codegen_1.str)`must NOT have ${comp} than ${schemaCode} properties`;
    },
    params: ({ schemaCode }) => (0, codegen_1._)`{limit: ${schemaCode}}`
  };
  var def = {
    keyword: ["maxProperties", "minProperties"],
    type: "object",
    schemaType: "number",
    $data: true,
    error,
    code(cxt) {
      const { keyword, data, schemaCode } = cxt;
      const op = keyword === "maxProperties" ? codegen_1.operators.GT : codegen_1.operators.LT;
      cxt.fail$data((0, codegen_1._)`Object.keys(${data}).length ${op} ${schemaCode}`);
    }
  };
  exports.default = def;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/validation/required.js
var require_required = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var code_1 = require_code2();
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  var error = {
    message: ({ params: { missingProperty } }) => (0, codegen_1.str)`must have required property '${missingProperty}'`,
    params: ({ params: { missingProperty } }) => (0, codegen_1._)`{missingProperty: ${missingProperty}}`
  };
  var def = {
    keyword: "required",
    type: "object",
    schemaType: "array",
    $data: true,
    error,
    code(cxt) {
      const { gen, schema, schemaCode, data, $data, it } = cxt;
      const { opts } = it;
      if (!$data && schema.length === 0)
        return;
      const useLoop = schema.length >= opts.loopRequired;
      if (it.allErrors)
        allErrorsMode();
      else
        exitOnErrorMode();
      if (opts.strictRequired) {
        const props = cxt.parentSchema.properties;
        const { definedProperties } = cxt.it;
        for (const requiredKey of schema) {
          if ((props === null || props === undefined ? undefined : props[requiredKey]) === undefined && !definedProperties.has(requiredKey)) {
            const schemaPath = it.schemaEnv.baseId + it.errSchemaPath;
            const msg = `required property "${requiredKey}" is not defined at "${schemaPath}" (strictRequired)`;
            (0, util_1.checkStrictMode)(it, msg, it.opts.strictRequired);
          }
        }
      }
      function allErrorsMode() {
        if (useLoop || $data) {
          cxt.block$data(codegen_1.nil, loopAllRequired);
        } else {
          for (const prop of schema) {
            (0, code_1.checkReportMissingProp)(cxt, prop);
          }
        }
      }
      function exitOnErrorMode() {
        const missing = gen.let("missing");
        if (useLoop || $data) {
          const valid = gen.let("valid", true);
          cxt.block$data(valid, () => loopUntilMissing(missing, valid));
          cxt.ok(valid);
        } else {
          gen.if((0, code_1.checkMissingProp)(cxt, schema, missing));
          (0, code_1.reportMissingProp)(cxt, missing);
          gen.else();
        }
      }
      function loopAllRequired() {
        gen.forOf("prop", schemaCode, (prop) => {
          cxt.setParams({ missingProperty: prop });
          gen.if((0, code_1.noPropertyInData)(gen, data, prop, opts.ownProperties), () => cxt.error());
        });
      }
      function loopUntilMissing(missing, valid) {
        cxt.setParams({ missingProperty: missing });
        gen.forOf(missing, schemaCode, () => {
          gen.assign(valid, (0, code_1.propertyInData)(gen, data, missing, opts.ownProperties));
          gen.if((0, codegen_1.not)(valid), () => {
            cxt.error();
            gen.break();
          });
        }, codegen_1.nil);
      }
    }
  };
  exports.default = def;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/validation/limitItems.js
var require_limitItems = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var codegen_1 = require_codegen();
  var error = {
    message({ keyword, schemaCode }) {
      const comp = keyword === "maxItems" ? "more" : "fewer";
      return (0, codegen_1.str)`must NOT have ${comp} than ${schemaCode} items`;
    },
    params: ({ schemaCode }) => (0, codegen_1._)`{limit: ${schemaCode}}`
  };
  var def = {
    keyword: ["maxItems", "minItems"],
    type: "array",
    schemaType: "number",
    $data: true,
    error,
    code(cxt) {
      const { keyword, data, schemaCode } = cxt;
      const op = keyword === "maxItems" ? codegen_1.operators.GT : codegen_1.operators.LT;
      cxt.fail$data((0, codegen_1._)`${data}.length ${op} ${schemaCode}`);
    }
  };
  exports.default = def;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/runtime/equal.js
var require_equal = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var equal = require_fast_deep_equal();
  equal.code = 'require("ajv/dist/runtime/equal").default';
  exports.default = equal;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/validation/uniqueItems.js
var require_uniqueItems = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var dataType_1 = require_dataType();
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  var equal_1 = require_equal();
  var error = {
    message: ({ params: { i, j } }) => (0, codegen_1.str)`must NOT have duplicate items (items ## ${j} and ${i} are identical)`,
    params: ({ params: { i, j } }) => (0, codegen_1._)`{i: ${i}, j: ${j}}`
  };
  var def = {
    keyword: "uniqueItems",
    type: "array",
    schemaType: "boolean",
    $data: true,
    error,
    code(cxt) {
      const { gen, data, $data, schema, parentSchema, schemaCode, it } = cxt;
      if (!$data && !schema)
        return;
      const valid = gen.let("valid");
      const itemTypes = parentSchema.items ? (0, dataType_1.getSchemaTypes)(parentSchema.items) : [];
      cxt.block$data(valid, validateUniqueItems, (0, codegen_1._)`${schemaCode} === false`);
      cxt.ok(valid);
      function validateUniqueItems() {
        const i = gen.let("i", (0, codegen_1._)`${data}.length`);
        const j = gen.let("j");
        cxt.setParams({ i, j });
        gen.assign(valid, true);
        gen.if((0, codegen_1._)`${i} > 1`, () => (canOptimize() ? loopN : loopN2)(i, j));
      }
      function canOptimize() {
        return itemTypes.length > 0 && !itemTypes.some((t) => t === "object" || t === "array");
      }
      function loopN(i, j) {
        const item = gen.name("item");
        const wrongType = (0, dataType_1.checkDataTypes)(itemTypes, item, it.opts.strictNumbers, dataType_1.DataType.Wrong);
        const indices = gen.const("indices", (0, codegen_1._)`{}`);
        gen.for((0, codegen_1._)`;${i}--;`, () => {
          gen.let(item, (0, codegen_1._)`${data}[${i}]`);
          gen.if(wrongType, (0, codegen_1._)`continue`);
          if (itemTypes.length > 1)
            gen.if((0, codegen_1._)`typeof ${item} == "string"`, (0, codegen_1._)`${item} += "_"`);
          gen.if((0, codegen_1._)`typeof ${indices}[${item}] == "number"`, () => {
            gen.assign(j, (0, codegen_1._)`${indices}[${item}]`);
            cxt.error();
            gen.assign(valid, false).break();
          }).code((0, codegen_1._)`${indices}[${item}] = ${i}`);
        });
      }
      function loopN2(i, j) {
        const eql = (0, util_1.useFunc)(gen, equal_1.default);
        const outer = gen.name("outer");
        gen.label(outer).for((0, codegen_1._)`;${i}--;`, () => gen.for((0, codegen_1._)`${j} = ${i}; ${j}--;`, () => gen.if((0, codegen_1._)`${eql}(${data}[${i}], ${data}[${j}])`, () => {
          cxt.error();
          gen.assign(valid, false).break(outer);
        })));
      }
    }
  };
  exports.default = def;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/validation/const.js
var require_const = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  var equal_1 = require_equal();
  var error = {
    message: "must be equal to constant",
    params: ({ schemaCode }) => (0, codegen_1._)`{allowedValue: ${schemaCode}}`
  };
  var def = {
    keyword: "const",
    $data: true,
    error,
    code(cxt) {
      const { gen, data, $data, schemaCode, schema } = cxt;
      if ($data || schema && typeof schema == "object") {
        cxt.fail$data((0, codegen_1._)`!${(0, util_1.useFunc)(gen, equal_1.default)}(${data}, ${schemaCode})`);
      } else {
        cxt.fail((0, codegen_1._)`${schema} !== ${data}`);
      }
    }
  };
  exports.default = def;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/validation/enum.js
var require_enum = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  var equal_1 = require_equal();
  var error = {
    message: "must be equal to one of the allowed values",
    params: ({ schemaCode }) => (0, codegen_1._)`{allowedValues: ${schemaCode}}`
  };
  var def = {
    keyword: "enum",
    schemaType: "array",
    $data: true,
    error,
    code(cxt) {
      const { gen, data, $data, schema, schemaCode, it } = cxt;
      if (!$data && schema.length === 0)
        throw new Error("enum must have non-empty array");
      const useLoop = schema.length >= it.opts.loopEnum;
      let eql;
      const getEql = () => eql !== null && eql !== undefined ? eql : eql = (0, util_1.useFunc)(gen, equal_1.default);
      let valid;
      if (useLoop || $data) {
        valid = gen.let("valid");
        cxt.block$data(valid, loopEnum);
      } else {
        if (!Array.isArray(schema))
          throw new Error("ajv implementation error");
        const vSchema = gen.const("vSchema", schemaCode);
        valid = (0, codegen_1.or)(...schema.map((_x, i) => equalCode(vSchema, i)));
      }
      cxt.pass(valid);
      function loopEnum() {
        gen.assign(valid, false);
        gen.forOf("v", schemaCode, (v) => gen.if((0, codegen_1._)`${getEql()}(${data}, ${v})`, () => gen.assign(valid, true).break()));
      }
      function equalCode(vSchema, i) {
        const sch = schema[i];
        return typeof sch === "object" && sch !== null ? (0, codegen_1._)`${getEql()}(${data}, ${vSchema}[${i}])` : (0, codegen_1._)`${data} === ${sch}`;
      }
    }
  };
  exports.default = def;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/validation/index.js
var require_validation = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var limitNumber_1 = require_limitNumber();
  var multipleOf_1 = require_multipleOf();
  var limitLength_1 = require_limitLength();
  var pattern_1 = require_pattern();
  var limitProperties_1 = require_limitProperties();
  var required_1 = require_required();
  var limitItems_1 = require_limitItems();
  var uniqueItems_1 = require_uniqueItems();
  var const_1 = require_const();
  var enum_1 = require_enum();
  var validation = [
    limitNumber_1.default,
    multipleOf_1.default,
    limitLength_1.default,
    pattern_1.default,
    limitProperties_1.default,
    required_1.default,
    limitItems_1.default,
    uniqueItems_1.default,
    { keyword: "type", schemaType: ["string", "array"] },
    { keyword: "nullable", schemaType: "boolean" },
    const_1.default,
    enum_1.default
  ];
  exports.default = validation;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/additionalItems.js
var require_additionalItems = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.validateAdditionalItems = undefined;
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  var error = {
    message: ({ params: { len } }) => (0, codegen_1.str)`must NOT have more than ${len} items`,
    params: ({ params: { len } }) => (0, codegen_1._)`{limit: ${len}}`
  };
  var def = {
    keyword: "additionalItems",
    type: "array",
    schemaType: ["boolean", "object"],
    before: "uniqueItems",
    error,
    code(cxt) {
      const { parentSchema, it } = cxt;
      const { items } = parentSchema;
      if (!Array.isArray(items)) {
        (0, util_1.checkStrictMode)(it, '"additionalItems" is ignored when "items" is not an array of schemas');
        return;
      }
      validateAdditionalItems(cxt, items);
    }
  };
  function validateAdditionalItems(cxt, items) {
    const { gen, schema, data, keyword, it } = cxt;
    it.items = true;
    const len = gen.const("len", (0, codegen_1._)`${data}.length`);
    if (schema === false) {
      cxt.setParams({ len: items.length });
      cxt.pass((0, codegen_1._)`${len} <= ${items.length}`);
    } else if (typeof schema == "object" && !(0, util_1.alwaysValidSchema)(it, schema)) {
      const valid = gen.var("valid", (0, codegen_1._)`${len} <= ${items.length}`);
      gen.if((0, codegen_1.not)(valid), () => validateItems(valid));
      cxt.ok(valid);
    }
    function validateItems(valid) {
      gen.forRange("i", items.length, len, (i) => {
        cxt.subschema({ keyword, dataProp: i, dataPropType: util_1.Type.Num }, valid);
        if (!it.allErrors)
          gen.if((0, codegen_1.not)(valid), () => gen.break());
      });
    }
  }
  exports.validateAdditionalItems = validateAdditionalItems;
  exports.default = def;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/items.js
var require_items = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.validateTuple = undefined;
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  var code_1 = require_code2();
  var def = {
    keyword: "items",
    type: "array",
    schemaType: ["object", "array", "boolean"],
    before: "uniqueItems",
    code(cxt) {
      const { schema, it } = cxt;
      if (Array.isArray(schema))
        return validateTuple(cxt, "additionalItems", schema);
      it.items = true;
      if ((0, util_1.alwaysValidSchema)(it, schema))
        return;
      cxt.ok((0, code_1.validateArray)(cxt));
    }
  };
  function validateTuple(cxt, extraItems, schArr = cxt.schema) {
    const { gen, parentSchema, data, keyword, it } = cxt;
    checkStrictTuple(parentSchema);
    if (it.opts.unevaluated && schArr.length && it.items !== true) {
      it.items = util_1.mergeEvaluated.items(gen, schArr.length, it.items);
    }
    const valid = gen.name("valid");
    const len = gen.const("len", (0, codegen_1._)`${data}.length`);
    schArr.forEach((sch, i) => {
      if ((0, util_1.alwaysValidSchema)(it, sch))
        return;
      gen.if((0, codegen_1._)`${len} > ${i}`, () => cxt.subschema({
        keyword,
        schemaProp: i,
        dataProp: i
      }, valid));
      cxt.ok(valid);
    });
    function checkStrictTuple(sch) {
      const { opts, errSchemaPath } = it;
      const l = schArr.length;
      const fullTuple = l === sch.minItems && (l === sch.maxItems || sch[extraItems] === false);
      if (opts.strictTuples && !fullTuple) {
        const msg = `"${keyword}" is ${l}-tuple, but minItems or maxItems/${extraItems} are not specified or different at path "${errSchemaPath}"`;
        (0, util_1.checkStrictMode)(it, msg, opts.strictTuples);
      }
    }
  }
  exports.validateTuple = validateTuple;
  exports.default = def;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/prefixItems.js
var require_prefixItems = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var items_1 = require_items();
  var def = {
    keyword: "prefixItems",
    type: "array",
    schemaType: ["array"],
    before: "uniqueItems",
    code: (cxt) => (0, items_1.validateTuple)(cxt, "items")
  };
  exports.default = def;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/items2020.js
var require_items2020 = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  var code_1 = require_code2();
  var additionalItems_1 = require_additionalItems();
  var error = {
    message: ({ params: { len } }) => (0, codegen_1.str)`must NOT have more than ${len} items`,
    params: ({ params: { len } }) => (0, codegen_1._)`{limit: ${len}}`
  };
  var def = {
    keyword: "items",
    type: "array",
    schemaType: ["object", "boolean"],
    before: "uniqueItems",
    error,
    code(cxt) {
      const { schema, parentSchema, it } = cxt;
      const { prefixItems } = parentSchema;
      it.items = true;
      if ((0, util_1.alwaysValidSchema)(it, schema))
        return;
      if (prefixItems)
        (0, additionalItems_1.validateAdditionalItems)(cxt, prefixItems);
      else
        cxt.ok((0, code_1.validateArray)(cxt));
    }
  };
  exports.default = def;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/contains.js
var require_contains = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  var error = {
    message: ({ params: { min, max } }) => max === undefined ? (0, codegen_1.str)`must contain at least ${min} valid item(s)` : (0, codegen_1.str)`must contain at least ${min} and no more than ${max} valid item(s)`,
    params: ({ params: { min, max } }) => max === undefined ? (0, codegen_1._)`{minContains: ${min}}` : (0, codegen_1._)`{minContains: ${min}, maxContains: ${max}}`
  };
  var def = {
    keyword: "contains",
    type: "array",
    schemaType: ["object", "boolean"],
    before: "uniqueItems",
    trackErrors: true,
    error,
    code(cxt) {
      const { gen, schema, parentSchema, data, it } = cxt;
      let min;
      let max;
      const { minContains, maxContains } = parentSchema;
      if (it.opts.next) {
        min = minContains === undefined ? 1 : minContains;
        max = maxContains;
      } else {
        min = 1;
      }
      const len = gen.const("len", (0, codegen_1._)`${data}.length`);
      cxt.setParams({ min, max });
      if (max === undefined && min === 0) {
        (0, util_1.checkStrictMode)(it, `"minContains" == 0 without "maxContains": "contains" keyword ignored`);
        return;
      }
      if (max !== undefined && min > max) {
        (0, util_1.checkStrictMode)(it, `"minContains" > "maxContains" is always invalid`);
        cxt.fail();
        return;
      }
      if ((0, util_1.alwaysValidSchema)(it, schema)) {
        let cond = (0, codegen_1._)`${len} >= ${min}`;
        if (max !== undefined)
          cond = (0, codegen_1._)`${cond} && ${len} <= ${max}`;
        cxt.pass(cond);
        return;
      }
      it.items = true;
      const valid = gen.name("valid");
      if (max === undefined && min === 1) {
        validateItems(valid, () => gen.if(valid, () => gen.break()));
      } else if (min === 0) {
        gen.let(valid, true);
        if (max !== undefined)
          gen.if((0, codegen_1._)`${data}.length > 0`, validateItemsWithCount);
      } else {
        gen.let(valid, false);
        validateItemsWithCount();
      }
      cxt.result(valid, () => cxt.reset());
      function validateItemsWithCount() {
        const schValid = gen.name("_valid");
        const count = gen.let("count", 0);
        validateItems(schValid, () => gen.if(schValid, () => checkLimits(count)));
      }
      function validateItems(_valid, block) {
        gen.forRange("i", 0, len, (i) => {
          cxt.subschema({
            keyword: "contains",
            dataProp: i,
            dataPropType: util_1.Type.Num,
            compositeRule: true
          }, _valid);
          block();
        });
      }
      function checkLimits(count) {
        gen.code((0, codegen_1._)`${count}++`);
        if (max === undefined) {
          gen.if((0, codegen_1._)`${count} >= ${min}`, () => gen.assign(valid, true).break());
        } else {
          gen.if((0, codegen_1._)`${count} > ${max}`, () => gen.assign(valid, false).break());
          if (min === 1)
            gen.assign(valid, true);
          else
            gen.if((0, codegen_1._)`${count} >= ${min}`, () => gen.assign(valid, true));
        }
      }
    }
  };
  exports.default = def;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/dependencies.js
var require_dependencies = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.validateSchemaDeps = exports.validatePropertyDeps = exports.error = undefined;
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  var code_1 = require_code2();
  exports.error = {
    message: ({ params: { property, depsCount, deps } }) => {
      const property_ies = depsCount === 1 ? "property" : "properties";
      return (0, codegen_1.str)`must have ${property_ies} ${deps} when property ${property} is present`;
    },
    params: ({ params: { property, depsCount, deps, missingProperty } }) => (0, codegen_1._)`{property: ${property},
    missingProperty: ${missingProperty},
    depsCount: ${depsCount},
    deps: ${deps}}`
  };
  var def = {
    keyword: "dependencies",
    type: "object",
    schemaType: "object",
    error: exports.error,
    code(cxt) {
      const [propDeps, schDeps] = splitDependencies(cxt);
      validatePropertyDeps(cxt, propDeps);
      validateSchemaDeps(cxt, schDeps);
    }
  };
  function splitDependencies({ schema }) {
    const propertyDeps = {};
    const schemaDeps = {};
    for (const key in schema) {
      if (key === "__proto__")
        continue;
      const deps = Array.isArray(schema[key]) ? propertyDeps : schemaDeps;
      deps[key] = schema[key];
    }
    return [propertyDeps, schemaDeps];
  }
  function validatePropertyDeps(cxt, propertyDeps = cxt.schema) {
    const { gen, data, it } = cxt;
    if (Object.keys(propertyDeps).length === 0)
      return;
    const missing = gen.let("missing");
    for (const prop in propertyDeps) {
      const deps = propertyDeps[prop];
      if (deps.length === 0)
        continue;
      const hasProperty = (0, code_1.propertyInData)(gen, data, prop, it.opts.ownProperties);
      cxt.setParams({
        property: prop,
        depsCount: deps.length,
        deps: deps.join(", ")
      });
      if (it.allErrors) {
        gen.if(hasProperty, () => {
          for (const depProp of deps) {
            (0, code_1.checkReportMissingProp)(cxt, depProp);
          }
        });
      } else {
        gen.if((0, codegen_1._)`${hasProperty} && (${(0, code_1.checkMissingProp)(cxt, deps, missing)})`);
        (0, code_1.reportMissingProp)(cxt, missing);
        gen.else();
      }
    }
  }
  exports.validatePropertyDeps = validatePropertyDeps;
  function validateSchemaDeps(cxt, schemaDeps = cxt.schema) {
    const { gen, data, keyword, it } = cxt;
    const valid = gen.name("valid");
    for (const prop in schemaDeps) {
      if ((0, util_1.alwaysValidSchema)(it, schemaDeps[prop]))
        continue;
      gen.if((0, code_1.propertyInData)(gen, data, prop, it.opts.ownProperties), () => {
        const schCxt = cxt.subschema({ keyword, schemaProp: prop }, valid);
        cxt.mergeValidEvaluated(schCxt, valid);
      }, () => gen.var(valid, true));
      cxt.ok(valid);
    }
  }
  exports.validateSchemaDeps = validateSchemaDeps;
  exports.default = def;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/propertyNames.js
var require_propertyNames = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  var error = {
    message: "property name must be valid",
    params: ({ params }) => (0, codegen_1._)`{propertyName: ${params.propertyName}}`
  };
  var def = {
    keyword: "propertyNames",
    type: "object",
    schemaType: ["object", "boolean"],
    error,
    code(cxt) {
      const { gen, schema, data, it } = cxt;
      if ((0, util_1.alwaysValidSchema)(it, schema))
        return;
      const valid = gen.name("valid");
      gen.forIn("key", data, (key) => {
        cxt.setParams({ propertyName: key });
        cxt.subschema({
          keyword: "propertyNames",
          data: key,
          dataTypes: ["string"],
          propertyName: key,
          compositeRule: true
        }, valid);
        gen.if((0, codegen_1.not)(valid), () => {
          cxt.error(true);
          if (!it.allErrors)
            gen.break();
        });
      });
      cxt.ok(valid);
    }
  };
  exports.default = def;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/additionalProperties.js
var require_additionalProperties = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var code_1 = require_code2();
  var codegen_1 = require_codegen();
  var names_1 = require_names();
  var util_1 = require_util();
  var error = {
    message: "must NOT have additional properties",
    params: ({ params }) => (0, codegen_1._)`{additionalProperty: ${params.additionalProperty}}`
  };
  var def = {
    keyword: "additionalProperties",
    type: ["object"],
    schemaType: ["boolean", "object"],
    allowUndefined: true,
    trackErrors: true,
    error,
    code(cxt) {
      const { gen, schema, parentSchema, data, errsCount, it } = cxt;
      if (!errsCount)
        throw new Error("ajv implementation error");
      const { allErrors, opts } = it;
      it.props = true;
      if (opts.removeAdditional !== "all" && (0, util_1.alwaysValidSchema)(it, schema))
        return;
      const props = (0, code_1.allSchemaProperties)(parentSchema.properties);
      const patProps = (0, code_1.allSchemaProperties)(parentSchema.patternProperties);
      checkAdditionalProperties();
      cxt.ok((0, codegen_1._)`${errsCount} === ${names_1.default.errors}`);
      function checkAdditionalProperties() {
        gen.forIn("key", data, (key) => {
          if (!props.length && !patProps.length)
            additionalPropertyCode(key);
          else
            gen.if(isAdditional(key), () => additionalPropertyCode(key));
        });
      }
      function isAdditional(key) {
        let definedProp;
        if (props.length > 8) {
          const propsSchema = (0, util_1.schemaRefOrVal)(it, parentSchema.properties, "properties");
          definedProp = (0, code_1.isOwnProperty)(gen, propsSchema, key);
        } else if (props.length) {
          definedProp = (0, codegen_1.or)(...props.map((p) => (0, codegen_1._)`${key} === ${p}`));
        } else {
          definedProp = codegen_1.nil;
        }
        if (patProps.length) {
          definedProp = (0, codegen_1.or)(definedProp, ...patProps.map((p) => (0, codegen_1._)`${(0, code_1.usePattern)(cxt, p)}.test(${key})`));
        }
        return (0, codegen_1.not)(definedProp);
      }
      function deleteAdditional(key) {
        gen.code((0, codegen_1._)`delete ${data}[${key}]`);
      }
      function additionalPropertyCode(key) {
        if (opts.removeAdditional === "all" || opts.removeAdditional && schema === false) {
          deleteAdditional(key);
          return;
        }
        if (schema === false) {
          cxt.setParams({ additionalProperty: key });
          cxt.error();
          if (!allErrors)
            gen.break();
          return;
        }
        if (typeof schema == "object" && !(0, util_1.alwaysValidSchema)(it, schema)) {
          const valid = gen.name("valid");
          if (opts.removeAdditional === "failing") {
            applyAdditionalSchema(key, valid, false);
            gen.if((0, codegen_1.not)(valid), () => {
              cxt.reset();
              deleteAdditional(key);
            });
          } else {
            applyAdditionalSchema(key, valid);
            if (!allErrors)
              gen.if((0, codegen_1.not)(valid), () => gen.break());
          }
        }
      }
      function applyAdditionalSchema(key, valid, errors) {
        const subschema = {
          keyword: "additionalProperties",
          dataProp: key,
          dataPropType: util_1.Type.Str
        };
        if (errors === false) {
          Object.assign(subschema, {
            compositeRule: true,
            createErrors: false,
            allErrors: false
          });
        }
        cxt.subschema(subschema, valid);
      }
    }
  };
  exports.default = def;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/properties.js
var require_properties = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var validate_1 = require_validate();
  var code_1 = require_code2();
  var util_1 = require_util();
  var additionalProperties_1 = require_additionalProperties();
  var def = {
    keyword: "properties",
    type: "object",
    schemaType: "object",
    code(cxt) {
      const { gen, schema, parentSchema, data, it } = cxt;
      if (it.opts.removeAdditional === "all" && parentSchema.additionalProperties === undefined) {
        additionalProperties_1.default.code(new validate_1.KeywordCxt(it, additionalProperties_1.default, "additionalProperties"));
      }
      const allProps = (0, code_1.allSchemaProperties)(schema);
      for (const prop of allProps) {
        it.definedProperties.add(prop);
      }
      if (it.opts.unevaluated && allProps.length && it.props !== true) {
        it.props = util_1.mergeEvaluated.props(gen, (0, util_1.toHash)(allProps), it.props);
      }
      const properties = allProps.filter((p) => !(0, util_1.alwaysValidSchema)(it, schema[p]));
      if (properties.length === 0)
        return;
      const valid = gen.name("valid");
      for (const prop of properties) {
        if (hasDefault(prop)) {
          applyPropertySchema(prop);
        } else {
          gen.if((0, code_1.propertyInData)(gen, data, prop, it.opts.ownProperties));
          applyPropertySchema(prop);
          if (!it.allErrors)
            gen.else().var(valid, true);
          gen.endIf();
        }
        cxt.it.definedProperties.add(prop);
        cxt.ok(valid);
      }
      function hasDefault(prop) {
        return it.opts.useDefaults && !it.compositeRule && schema[prop].default !== undefined;
      }
      function applyPropertySchema(prop) {
        cxt.subschema({
          keyword: "properties",
          schemaProp: prop,
          dataProp: prop
        }, valid);
      }
    }
  };
  exports.default = def;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/patternProperties.js
var require_patternProperties = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var code_1 = require_code2();
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  var util_2 = require_util();
  var def = {
    keyword: "patternProperties",
    type: "object",
    schemaType: "object",
    code(cxt) {
      const { gen, schema, data, parentSchema, it } = cxt;
      const { opts } = it;
      const patterns = (0, code_1.allSchemaProperties)(schema);
      const alwaysValidPatterns = patterns.filter((p) => (0, util_1.alwaysValidSchema)(it, schema[p]));
      if (patterns.length === 0 || alwaysValidPatterns.length === patterns.length && (!it.opts.unevaluated || it.props === true)) {
        return;
      }
      const checkProperties = opts.strictSchema && !opts.allowMatchingProperties && parentSchema.properties;
      const valid = gen.name("valid");
      if (it.props !== true && !(it.props instanceof codegen_1.Name)) {
        it.props = (0, util_2.evaluatedPropsToName)(gen, it.props);
      }
      const { props } = it;
      validatePatternProperties();
      function validatePatternProperties() {
        for (const pat of patterns) {
          if (checkProperties)
            checkMatchingProperties(pat);
          if (it.allErrors) {
            validateProperties(pat);
          } else {
            gen.var(valid, true);
            validateProperties(pat);
            gen.if(valid);
          }
        }
      }
      function checkMatchingProperties(pat) {
        for (const prop in checkProperties) {
          if (new RegExp(pat).test(prop)) {
            (0, util_1.checkStrictMode)(it, `property ${prop} matches pattern ${pat} (use allowMatchingProperties)`);
          }
        }
      }
      function validateProperties(pat) {
        gen.forIn("key", data, (key) => {
          gen.if((0, codegen_1._)`${(0, code_1.usePattern)(cxt, pat)}.test(${key})`, () => {
            const alwaysValid = alwaysValidPatterns.includes(pat);
            if (!alwaysValid) {
              cxt.subschema({
                keyword: "patternProperties",
                schemaProp: pat,
                dataProp: key,
                dataPropType: util_2.Type.Str
              }, valid);
            }
            if (it.opts.unevaluated && props !== true) {
              gen.assign((0, codegen_1._)`${props}[${key}]`, true);
            } else if (!alwaysValid && !it.allErrors) {
              gen.if((0, codegen_1.not)(valid), () => gen.break());
            }
          });
        });
      }
    }
  };
  exports.default = def;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/not.js
var require_not = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var util_1 = require_util();
  var def = {
    keyword: "not",
    schemaType: ["object", "boolean"],
    trackErrors: true,
    code(cxt) {
      const { gen, schema, it } = cxt;
      if ((0, util_1.alwaysValidSchema)(it, schema)) {
        cxt.fail();
        return;
      }
      const valid = gen.name("valid");
      cxt.subschema({
        keyword: "not",
        compositeRule: true,
        createErrors: false,
        allErrors: false
      }, valid);
      cxt.failResult(valid, () => cxt.reset(), () => cxt.error());
    },
    error: { message: "must NOT be valid" }
  };
  exports.default = def;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/anyOf.js
var require_anyOf = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var code_1 = require_code2();
  var def = {
    keyword: "anyOf",
    schemaType: "array",
    trackErrors: true,
    code: code_1.validateUnion,
    error: { message: "must match a schema in anyOf" }
  };
  exports.default = def;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/oneOf.js
var require_oneOf = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  var error = {
    message: "must match exactly one schema in oneOf",
    params: ({ params }) => (0, codegen_1._)`{passingSchemas: ${params.passing}}`
  };
  var def = {
    keyword: "oneOf",
    schemaType: "array",
    trackErrors: true,
    error,
    code(cxt) {
      const { gen, schema, parentSchema, it } = cxt;
      if (!Array.isArray(schema))
        throw new Error("ajv implementation error");
      if (it.opts.discriminator && parentSchema.discriminator)
        return;
      const schArr = schema;
      const valid = gen.let("valid", false);
      const passing = gen.let("passing", null);
      const schValid = gen.name("_valid");
      cxt.setParams({ passing });
      gen.block(validateOneOf);
      cxt.result(valid, () => cxt.reset(), () => cxt.error(true));
      function validateOneOf() {
        schArr.forEach((sch, i) => {
          let schCxt;
          if ((0, util_1.alwaysValidSchema)(it, sch)) {
            gen.var(schValid, true);
          } else {
            schCxt = cxt.subschema({
              keyword: "oneOf",
              schemaProp: i,
              compositeRule: true
            }, schValid);
          }
          if (i > 0) {
            gen.if((0, codegen_1._)`${schValid} && ${valid}`).assign(valid, false).assign(passing, (0, codegen_1._)`[${passing}, ${i}]`).else();
          }
          gen.if(schValid, () => {
            gen.assign(valid, true);
            gen.assign(passing, i);
            if (schCxt)
              cxt.mergeEvaluated(schCxt, codegen_1.Name);
          });
        });
      }
    }
  };
  exports.default = def;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/allOf.js
var require_allOf = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var util_1 = require_util();
  var def = {
    keyword: "allOf",
    schemaType: "array",
    code(cxt) {
      const { gen, schema, it } = cxt;
      if (!Array.isArray(schema))
        throw new Error("ajv implementation error");
      const valid = gen.name("valid");
      schema.forEach((sch, i) => {
        if ((0, util_1.alwaysValidSchema)(it, sch))
          return;
        const schCxt = cxt.subschema({ keyword: "allOf", schemaProp: i }, valid);
        cxt.ok(valid);
        cxt.mergeEvaluated(schCxt);
      });
    }
  };
  exports.default = def;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/if.js
var require_if = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  var error = {
    message: ({ params }) => (0, codegen_1.str)`must match "${params.ifClause}" schema`,
    params: ({ params }) => (0, codegen_1._)`{failingKeyword: ${params.ifClause}}`
  };
  var def = {
    keyword: "if",
    schemaType: ["object", "boolean"],
    trackErrors: true,
    error,
    code(cxt) {
      const { gen, parentSchema, it } = cxt;
      if (parentSchema.then === undefined && parentSchema.else === undefined) {
        (0, util_1.checkStrictMode)(it, '"if" without "then" and "else" is ignored');
      }
      const hasThen = hasSchema(it, "then");
      const hasElse = hasSchema(it, "else");
      if (!hasThen && !hasElse)
        return;
      const valid = gen.let("valid", true);
      const schValid = gen.name("_valid");
      validateIf();
      cxt.reset();
      if (hasThen && hasElse) {
        const ifClause = gen.let("ifClause");
        cxt.setParams({ ifClause });
        gen.if(schValid, validateClause("then", ifClause), validateClause("else", ifClause));
      } else if (hasThen) {
        gen.if(schValid, validateClause("then"));
      } else {
        gen.if((0, codegen_1.not)(schValid), validateClause("else"));
      }
      cxt.pass(valid, () => cxt.error(true));
      function validateIf() {
        const schCxt = cxt.subschema({
          keyword: "if",
          compositeRule: true,
          createErrors: false,
          allErrors: false
        }, schValid);
        cxt.mergeEvaluated(schCxt);
      }
      function validateClause(keyword, ifClause) {
        return () => {
          const schCxt = cxt.subschema({ keyword }, schValid);
          gen.assign(valid, schValid);
          cxt.mergeValidEvaluated(schCxt, valid);
          if (ifClause)
            gen.assign(ifClause, (0, codegen_1._)`${keyword}`);
          else
            cxt.setParams({ ifClause: keyword });
        };
      }
    }
  };
  function hasSchema(it, keyword) {
    const schema = it.schema[keyword];
    return schema !== undefined && !(0, util_1.alwaysValidSchema)(it, schema);
  }
  exports.default = def;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/thenElse.js
var require_thenElse = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var util_1 = require_util();
  var def = {
    keyword: ["then", "else"],
    schemaType: ["object", "boolean"],
    code({ keyword, parentSchema, it }) {
      if (parentSchema.if === undefined)
        (0, util_1.checkStrictMode)(it, `"${keyword}" without "if" is ignored`);
    }
  };
  exports.default = def;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/index.js
var require_applicator = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var additionalItems_1 = require_additionalItems();
  var prefixItems_1 = require_prefixItems();
  var items_1 = require_items();
  var items2020_1 = require_items2020();
  var contains_1 = require_contains();
  var dependencies_1 = require_dependencies();
  var propertyNames_1 = require_propertyNames();
  var additionalProperties_1 = require_additionalProperties();
  var properties_1 = require_properties();
  var patternProperties_1 = require_patternProperties();
  var not_1 = require_not();
  var anyOf_1 = require_anyOf();
  var oneOf_1 = require_oneOf();
  var allOf_1 = require_allOf();
  var if_1 = require_if();
  var thenElse_1 = require_thenElse();
  function getApplicator(draft2020 = false) {
    const applicator = [
      not_1.default,
      anyOf_1.default,
      oneOf_1.default,
      allOf_1.default,
      if_1.default,
      thenElse_1.default,
      propertyNames_1.default,
      additionalProperties_1.default,
      dependencies_1.default,
      properties_1.default,
      patternProperties_1.default
    ];
    if (draft2020)
      applicator.push(prefixItems_1.default, items2020_1.default);
    else
      applicator.push(additionalItems_1.default, items_1.default);
    applicator.push(contains_1.default);
    return applicator;
  }
  exports.default = getApplicator;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/dynamic/dynamicAnchor.js
var require_dynamicAnchor = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.dynamicAnchor = undefined;
  var codegen_1 = require_codegen();
  var names_1 = require_names();
  var compile_1 = require_compile();
  var ref_1 = require_ref();
  var def = {
    keyword: "$dynamicAnchor",
    schemaType: "string",
    code: (cxt) => dynamicAnchor(cxt, cxt.schema)
  };
  function dynamicAnchor(cxt, anchor) {
    const { gen, it } = cxt;
    it.schemaEnv.root.dynamicAnchors[anchor] = true;
    const v = (0, codegen_1._)`${names_1.default.dynamicAnchors}${(0, codegen_1.getProperty)(anchor)}`;
    const validate = it.errSchemaPath === "#" ? it.validateName : _getValidate(cxt);
    gen.if((0, codegen_1._)`!${v}`, () => gen.assign(v, validate));
  }
  exports.dynamicAnchor = dynamicAnchor;
  function _getValidate(cxt) {
    const { schemaEnv, schema, self } = cxt.it;
    const { root, baseId, localRefs, meta } = schemaEnv.root;
    const { schemaId } = self.opts;
    const sch = new compile_1.SchemaEnv({ schema, schemaId, root, baseId, localRefs, meta });
    compile_1.compileSchema.call(self, sch);
    return (0, ref_1.getValidate)(cxt, sch);
  }
  exports.default = def;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/dynamic/dynamicRef.js
var require_dynamicRef = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.dynamicRef = undefined;
  var codegen_1 = require_codegen();
  var names_1 = require_names();
  var ref_1 = require_ref();
  var def = {
    keyword: "$dynamicRef",
    schemaType: "string",
    code: (cxt) => dynamicRef(cxt, cxt.schema)
  };
  function dynamicRef(cxt, ref) {
    const { gen, keyword, it } = cxt;
    if (ref[0] !== "#")
      throw new Error(`"${keyword}" only supports hash fragment reference`);
    const anchor = ref.slice(1);
    if (it.allErrors) {
      _dynamicRef();
    } else {
      const valid = gen.let("valid", false);
      _dynamicRef(valid);
      cxt.ok(valid);
    }
    function _dynamicRef(valid) {
      if (it.schemaEnv.root.dynamicAnchors[anchor]) {
        const v = gen.let("_v", (0, codegen_1._)`${names_1.default.dynamicAnchors}${(0, codegen_1.getProperty)(anchor)}`);
        gen.if(v, _callRef(v, valid), _callRef(it.validateName, valid));
      } else {
        _callRef(it.validateName, valid)();
      }
    }
    function _callRef(validate, valid) {
      return valid ? () => gen.block(() => {
        (0, ref_1.callRef)(cxt, validate);
        gen.let(valid, true);
      }) : () => (0, ref_1.callRef)(cxt, validate);
    }
  }
  exports.dynamicRef = dynamicRef;
  exports.default = def;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/dynamic/recursiveAnchor.js
var require_recursiveAnchor = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var dynamicAnchor_1 = require_dynamicAnchor();
  var util_1 = require_util();
  var def = {
    keyword: "$recursiveAnchor",
    schemaType: "boolean",
    code(cxt) {
      if (cxt.schema)
        (0, dynamicAnchor_1.dynamicAnchor)(cxt, "");
      else
        (0, util_1.checkStrictMode)(cxt.it, "$recursiveAnchor: false is ignored");
    }
  };
  exports.default = def;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/dynamic/recursiveRef.js
var require_recursiveRef = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var dynamicRef_1 = require_dynamicRef();
  var def = {
    keyword: "$recursiveRef",
    schemaType: "string",
    code: (cxt) => (0, dynamicRef_1.dynamicRef)(cxt, cxt.schema)
  };
  exports.default = def;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/dynamic/index.js
var require_dynamic = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var dynamicAnchor_1 = require_dynamicAnchor();
  var dynamicRef_1 = require_dynamicRef();
  var recursiveAnchor_1 = require_recursiveAnchor();
  var recursiveRef_1 = require_recursiveRef();
  var dynamic = [dynamicAnchor_1.default, dynamicRef_1.default, recursiveAnchor_1.default, recursiveRef_1.default];
  exports.default = dynamic;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/validation/dependentRequired.js
var require_dependentRequired = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var dependencies_1 = require_dependencies();
  var def = {
    keyword: "dependentRequired",
    type: "object",
    schemaType: "object",
    error: dependencies_1.error,
    code: (cxt) => (0, dependencies_1.validatePropertyDeps)(cxt)
  };
  exports.default = def;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/dependentSchemas.js
var require_dependentSchemas = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var dependencies_1 = require_dependencies();
  var def = {
    keyword: "dependentSchemas",
    type: "object",
    schemaType: "object",
    code: (cxt) => (0, dependencies_1.validateSchemaDeps)(cxt)
  };
  exports.default = def;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/validation/limitContains.js
var require_limitContains = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var util_1 = require_util();
  var def = {
    keyword: ["maxContains", "minContains"],
    type: "array",
    schemaType: "number",
    code({ keyword, parentSchema, it }) {
      if (parentSchema.contains === undefined) {
        (0, util_1.checkStrictMode)(it, `"${keyword}" without "contains" is ignored`);
      }
    }
  };
  exports.default = def;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/next.js
var require_next = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var dependentRequired_1 = require_dependentRequired();
  var dependentSchemas_1 = require_dependentSchemas();
  var limitContains_1 = require_limitContains();
  var next = [dependentRequired_1.default, dependentSchemas_1.default, limitContains_1.default];
  exports.default = next;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/unevaluated/unevaluatedProperties.js
var require_unevaluatedProperties = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  var names_1 = require_names();
  var error = {
    message: "must NOT have unevaluated properties",
    params: ({ params }) => (0, codegen_1._)`{unevaluatedProperty: ${params.unevaluatedProperty}}`
  };
  var def = {
    keyword: "unevaluatedProperties",
    type: "object",
    schemaType: ["boolean", "object"],
    trackErrors: true,
    error,
    code(cxt) {
      const { gen, schema, data, errsCount, it } = cxt;
      if (!errsCount)
        throw new Error("ajv implementation error");
      const { allErrors, props } = it;
      if (props instanceof codegen_1.Name) {
        gen.if((0, codegen_1._)`${props} !== true`, () => gen.forIn("key", data, (key) => gen.if(unevaluatedDynamic(props, key), () => unevaluatedPropCode(key))));
      } else if (props !== true) {
        gen.forIn("key", data, (key) => props === undefined ? unevaluatedPropCode(key) : gen.if(unevaluatedStatic(props, key), () => unevaluatedPropCode(key)));
      }
      it.props = true;
      cxt.ok((0, codegen_1._)`${errsCount} === ${names_1.default.errors}`);
      function unevaluatedPropCode(key) {
        if (schema === false) {
          cxt.setParams({ unevaluatedProperty: key });
          cxt.error();
          if (!allErrors)
            gen.break();
          return;
        }
        if (!(0, util_1.alwaysValidSchema)(it, schema)) {
          const valid = gen.name("valid");
          cxt.subschema({
            keyword: "unevaluatedProperties",
            dataProp: key,
            dataPropType: util_1.Type.Str
          }, valid);
          if (!allErrors)
            gen.if((0, codegen_1.not)(valid), () => gen.break());
        }
      }
      function unevaluatedDynamic(evaluatedProps, key) {
        return (0, codegen_1._)`!${evaluatedProps} || !${evaluatedProps}[${key}]`;
      }
      function unevaluatedStatic(evaluatedProps, key) {
        const ps = [];
        for (const p in evaluatedProps) {
          if (evaluatedProps[p] === true)
            ps.push((0, codegen_1._)`${key} !== ${p}`);
        }
        return (0, codegen_1.and)(...ps);
      }
    }
  };
  exports.default = def;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/unevaluated/unevaluatedItems.js
var require_unevaluatedItems = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  var error = {
    message: ({ params: { len } }) => (0, codegen_1.str)`must NOT have more than ${len} items`,
    params: ({ params: { len } }) => (0, codegen_1._)`{limit: ${len}}`
  };
  var def = {
    keyword: "unevaluatedItems",
    type: "array",
    schemaType: ["boolean", "object"],
    error,
    code(cxt) {
      const { gen, schema, data, it } = cxt;
      const items = it.items || 0;
      if (items === true)
        return;
      const len = gen.const("len", (0, codegen_1._)`${data}.length`);
      if (schema === false) {
        cxt.setParams({ len: items });
        cxt.fail((0, codegen_1._)`${len} > ${items}`);
      } else if (typeof schema == "object" && !(0, util_1.alwaysValidSchema)(it, schema)) {
        const valid = gen.var("valid", (0, codegen_1._)`${len} <= ${items}`);
        gen.if((0, codegen_1.not)(valid), () => validateItems(valid, items));
        cxt.ok(valid);
      }
      it.items = true;
      function validateItems(valid, from) {
        gen.forRange("i", from, len, (i) => {
          cxt.subschema({ keyword: "unevaluatedItems", dataProp: i, dataPropType: util_1.Type.Num }, valid);
          if (!it.allErrors)
            gen.if((0, codegen_1.not)(valid), () => gen.break());
        });
      }
    }
  };
  exports.default = def;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/unevaluated/index.js
var require_unevaluated = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var unevaluatedProperties_1 = require_unevaluatedProperties();
  var unevaluatedItems_1 = require_unevaluatedItems();
  var unevaluated = [unevaluatedProperties_1.default, unevaluatedItems_1.default];
  exports.default = unevaluated;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/format/format.js
var require_format = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var codegen_1 = require_codegen();
  var error = {
    message: ({ schemaCode }) => (0, codegen_1.str)`must match format "${schemaCode}"`,
    params: ({ schemaCode }) => (0, codegen_1._)`{format: ${schemaCode}}`
  };
  var def = {
    keyword: "format",
    type: ["number", "string"],
    schemaType: "string",
    $data: true,
    error,
    code(cxt, ruleType) {
      const { gen, data, $data, schema, schemaCode, it } = cxt;
      const { opts, errSchemaPath, schemaEnv, self } = it;
      if (!opts.validateFormats)
        return;
      if ($data)
        validate$DataFormat();
      else
        validateFormat();
      function validate$DataFormat() {
        const fmts = gen.scopeValue("formats", {
          ref: self.formats,
          code: opts.code.formats
        });
        const fDef = gen.const("fDef", (0, codegen_1._)`${fmts}[${schemaCode}]`);
        const fType = gen.let("fType");
        const format = gen.let("format");
        gen.if((0, codegen_1._)`typeof ${fDef} == "object" && !(${fDef} instanceof RegExp)`, () => gen.assign(fType, (0, codegen_1._)`${fDef}.type || "string"`).assign(format, (0, codegen_1._)`${fDef}.validate`), () => gen.assign(fType, (0, codegen_1._)`"string"`).assign(format, fDef));
        cxt.fail$data((0, codegen_1.or)(unknownFmt(), invalidFmt()));
        function unknownFmt() {
          if (opts.strictSchema === false)
            return codegen_1.nil;
          return (0, codegen_1._)`${schemaCode} && !${format}`;
        }
        function invalidFmt() {
          const callFormat = schemaEnv.$async ? (0, codegen_1._)`(${fDef}.async ? await ${format}(${data}) : ${format}(${data}))` : (0, codegen_1._)`${format}(${data})`;
          const validData = (0, codegen_1._)`(typeof ${format} == "function" ? ${callFormat} : ${format}.test(${data}))`;
          return (0, codegen_1._)`${format} && ${format} !== true && ${fType} === ${ruleType} && !${validData}`;
        }
      }
      function validateFormat() {
        const formatDef = self.formats[schema];
        if (!formatDef) {
          unknownFormat();
          return;
        }
        if (formatDef === true)
          return;
        const [fmtType, format, fmtRef] = getFormat(formatDef);
        if (fmtType === ruleType)
          cxt.pass(validCondition());
        function unknownFormat() {
          if (opts.strictSchema === false) {
            self.logger.warn(unknownMsg());
            return;
          }
          throw new Error(unknownMsg());
          function unknownMsg() {
            return `unknown format "${schema}" ignored in schema at path "${errSchemaPath}"`;
          }
        }
        function getFormat(fmtDef) {
          const code = fmtDef instanceof RegExp ? (0, codegen_1.regexpCode)(fmtDef) : opts.code.formats ? (0, codegen_1._)`${opts.code.formats}${(0, codegen_1.getProperty)(schema)}` : undefined;
          const fmt = gen.scopeValue("formats", { key: schema, ref: fmtDef, code });
          if (typeof fmtDef == "object" && !(fmtDef instanceof RegExp)) {
            return [fmtDef.type || "string", fmtDef.validate, (0, codegen_1._)`${fmt}.validate`];
          }
          return ["string", fmtDef, fmt];
        }
        function validCondition() {
          if (typeof formatDef == "object" && !(formatDef instanceof RegExp) && formatDef.async) {
            if (!schemaEnv.$async)
              throw new Error("async format in sync schema");
            return (0, codegen_1._)`await ${fmtRef}(${data})`;
          }
          return typeof format == "function" ? (0, codegen_1._)`${fmtRef}(${data})` : (0, codegen_1._)`${fmtRef}.test(${data})`;
        }
      }
    }
  };
  exports.default = def;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/format/index.js
var require_format2 = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var format_1 = require_format();
  var format = [format_1.default];
  exports.default = format;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/metadata.js
var require_metadata = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.contentVocabulary = exports.metadataVocabulary = undefined;
  exports.metadataVocabulary = [
    "title",
    "description",
    "default",
    "deprecated",
    "readOnly",
    "writeOnly",
    "examples"
  ];
  exports.contentVocabulary = [
    "contentMediaType",
    "contentEncoding",
    "contentSchema"
  ];
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/draft2020.js
var require_draft2020 = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var core_1 = require_core2();
  var validation_1 = require_validation();
  var applicator_1 = require_applicator();
  var dynamic_1 = require_dynamic();
  var next_1 = require_next();
  var unevaluated_1 = require_unevaluated();
  var format_1 = require_format2();
  var metadata_1 = require_metadata();
  var draft2020Vocabularies = [
    dynamic_1.default,
    core_1.default,
    validation_1.default,
    (0, applicator_1.default)(true),
    format_1.default,
    metadata_1.metadataVocabulary,
    metadata_1.contentVocabulary,
    next_1.default,
    unevaluated_1.default
  ];
  exports.default = draft2020Vocabularies;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/discriminator/types.js
var require_types = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.DiscrError = undefined;
  var DiscrError;
  (function(DiscrError2) {
    DiscrError2["Tag"] = "tag";
    DiscrError2["Mapping"] = "mapping";
  })(DiscrError || (exports.DiscrError = DiscrError = {}));
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/discriminator/index.js
var require_discriminator = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var codegen_1 = require_codegen();
  var types_1 = require_types();
  var compile_1 = require_compile();
  var ref_error_1 = require_ref_error();
  var util_1 = require_util();
  var error = {
    message: ({ params: { discrError, tagName } }) => discrError === types_1.DiscrError.Tag ? `tag "${tagName}" must be string` : `value of tag "${tagName}" must be in oneOf`,
    params: ({ params: { discrError, tag, tagName } }) => (0, codegen_1._)`{error: ${discrError}, tag: ${tagName}, tagValue: ${tag}}`
  };
  var def = {
    keyword: "discriminator",
    type: "object",
    schemaType: "object",
    error,
    code(cxt) {
      const { gen, data, schema, parentSchema, it } = cxt;
      const { oneOf } = parentSchema;
      if (!it.opts.discriminator) {
        throw new Error("discriminator: requires discriminator option");
      }
      const tagName = schema.propertyName;
      if (typeof tagName != "string")
        throw new Error("discriminator: requires propertyName");
      if (schema.mapping)
        throw new Error("discriminator: mapping is not supported");
      if (!oneOf)
        throw new Error("discriminator: requires oneOf keyword");
      const valid = gen.let("valid", false);
      const tag = gen.const("tag", (0, codegen_1._)`${data}${(0, codegen_1.getProperty)(tagName)}`);
      gen.if((0, codegen_1._)`typeof ${tag} == "string"`, () => validateMapping(), () => cxt.error(false, { discrError: types_1.DiscrError.Tag, tag, tagName }));
      cxt.ok(valid);
      function validateMapping() {
        const mapping = getMapping();
        gen.if(false);
        for (const tagValue in mapping) {
          gen.elseIf((0, codegen_1._)`${tag} === ${tagValue}`);
          gen.assign(valid, applyTagSchema(mapping[tagValue]));
        }
        gen.else();
        cxt.error(false, { discrError: types_1.DiscrError.Mapping, tag, tagName });
        gen.endIf();
      }
      function applyTagSchema(schemaProp) {
        const _valid = gen.name("valid");
        const schCxt = cxt.subschema({ keyword: "oneOf", schemaProp }, _valid);
        cxt.mergeEvaluated(schCxt, codegen_1.Name);
        return _valid;
      }
      function getMapping() {
        var _a;
        const oneOfMapping = {};
        const topRequired = hasRequired(parentSchema);
        let tagRequired = true;
        for (let i = 0;i < oneOf.length; i++) {
          let sch = oneOf[i];
          if ((sch === null || sch === undefined ? undefined : sch.$ref) && !(0, util_1.schemaHasRulesButRef)(sch, it.self.RULES)) {
            const ref = sch.$ref;
            sch = compile_1.resolveRef.call(it.self, it.schemaEnv.root, it.baseId, ref);
            if (sch instanceof compile_1.SchemaEnv)
              sch = sch.schema;
            if (sch === undefined)
              throw new ref_error_1.default(it.opts.uriResolver, it.baseId, ref);
          }
          const propSch = (_a = sch === null || sch === undefined ? undefined : sch.properties) === null || _a === undefined ? undefined : _a[tagName];
          if (typeof propSch != "object") {
            throw new Error(`discriminator: oneOf subschemas (or referenced schemas) must have "properties/${tagName}"`);
          }
          tagRequired = tagRequired && (topRequired || hasRequired(sch));
          addMappings(propSch, i);
        }
        if (!tagRequired)
          throw new Error(`discriminator: "${tagName}" must be required`);
        return oneOfMapping;
        function hasRequired({ required }) {
          return Array.isArray(required) && required.includes(tagName);
        }
        function addMappings(sch, i) {
          if (sch.const) {
            addMapping(sch.const, i);
          } else if (sch.enum) {
            for (const tagValue of sch.enum) {
              addMapping(tagValue, i);
            }
          } else {
            throw new Error(`discriminator: "properties/${tagName}" must have "const" or "enum"`);
          }
        }
        function addMapping(tagValue, i) {
          if (typeof tagValue != "string" || tagValue in oneOfMapping) {
            throw new Error(`discriminator: "${tagName}" values must be unique strings`);
          }
          oneOfMapping[tagValue] = i;
        }
      }
    }
  };
  exports.default = def;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/refs/json-schema-2020-12/schema.json
var require_schema = __commonJS((exports, module) => {
  module.exports = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://json-schema.org/draft/2020-12/schema",
    $vocabulary: {
      "https://json-schema.org/draft/2020-12/vocab/core": true,
      "https://json-schema.org/draft/2020-12/vocab/applicator": true,
      "https://json-schema.org/draft/2020-12/vocab/unevaluated": true,
      "https://json-schema.org/draft/2020-12/vocab/validation": true,
      "https://json-schema.org/draft/2020-12/vocab/meta-data": true,
      "https://json-schema.org/draft/2020-12/vocab/format-annotation": true,
      "https://json-schema.org/draft/2020-12/vocab/content": true
    },
    $dynamicAnchor: "meta",
    title: "Core and Validation specifications meta-schema",
    allOf: [
      { $ref: "meta/core" },
      { $ref: "meta/applicator" },
      { $ref: "meta/unevaluated" },
      { $ref: "meta/validation" },
      { $ref: "meta/meta-data" },
      { $ref: "meta/format-annotation" },
      { $ref: "meta/content" }
    ],
    type: ["object", "boolean"],
    $comment: "This meta-schema also defines keywords that have appeared in previous drafts in order to prevent incompatible extensions as they remain in common use.",
    properties: {
      definitions: {
        $comment: '"definitions" has been replaced by "$defs".',
        type: "object",
        additionalProperties: { $dynamicRef: "#meta" },
        deprecated: true,
        default: {}
      },
      dependencies: {
        $comment: '"dependencies" has been split and replaced by "dependentSchemas" and "dependentRequired" in order to serve their differing semantics.',
        type: "object",
        additionalProperties: {
          anyOf: [{ $dynamicRef: "#meta" }, { $ref: "meta/validation#/$defs/stringArray" }]
        },
        deprecated: true,
        default: {}
      },
      $recursiveAnchor: {
        $comment: '"$recursiveAnchor" has been replaced by "$dynamicAnchor".',
        $ref: "meta/core#/$defs/anchorString",
        deprecated: true
      },
      $recursiveRef: {
        $comment: '"$recursiveRef" has been replaced by "$dynamicRef".',
        $ref: "meta/core#/$defs/uriReferenceString",
        deprecated: true
      }
    }
  };
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/refs/json-schema-2020-12/meta/applicator.json
var require_applicator2 = __commonJS((exports, module) => {
  module.exports = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://json-schema.org/draft/2020-12/meta/applicator",
    $vocabulary: {
      "https://json-schema.org/draft/2020-12/vocab/applicator": true
    },
    $dynamicAnchor: "meta",
    title: "Applicator vocabulary meta-schema",
    type: ["object", "boolean"],
    properties: {
      prefixItems: { $ref: "#/$defs/schemaArray" },
      items: { $dynamicRef: "#meta" },
      contains: { $dynamicRef: "#meta" },
      additionalProperties: { $dynamicRef: "#meta" },
      properties: {
        type: "object",
        additionalProperties: { $dynamicRef: "#meta" },
        default: {}
      },
      patternProperties: {
        type: "object",
        additionalProperties: { $dynamicRef: "#meta" },
        propertyNames: { format: "regex" },
        default: {}
      },
      dependentSchemas: {
        type: "object",
        additionalProperties: { $dynamicRef: "#meta" },
        default: {}
      },
      propertyNames: { $dynamicRef: "#meta" },
      if: { $dynamicRef: "#meta" },
      then: { $dynamicRef: "#meta" },
      else: { $dynamicRef: "#meta" },
      allOf: { $ref: "#/$defs/schemaArray" },
      anyOf: { $ref: "#/$defs/schemaArray" },
      oneOf: { $ref: "#/$defs/schemaArray" },
      not: { $dynamicRef: "#meta" }
    },
    $defs: {
      schemaArray: {
        type: "array",
        minItems: 1,
        items: { $dynamicRef: "#meta" }
      }
    }
  };
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/refs/json-schema-2020-12/meta/unevaluated.json
var require_unevaluated2 = __commonJS((exports, module) => {
  module.exports = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://json-schema.org/draft/2020-12/meta/unevaluated",
    $vocabulary: {
      "https://json-schema.org/draft/2020-12/vocab/unevaluated": true
    },
    $dynamicAnchor: "meta",
    title: "Unevaluated applicator vocabulary meta-schema",
    type: ["object", "boolean"],
    properties: {
      unevaluatedItems: { $dynamicRef: "#meta" },
      unevaluatedProperties: { $dynamicRef: "#meta" }
    }
  };
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/refs/json-schema-2020-12/meta/content.json
var require_content = __commonJS((exports, module) => {
  module.exports = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://json-schema.org/draft/2020-12/meta/content",
    $vocabulary: {
      "https://json-schema.org/draft/2020-12/vocab/content": true
    },
    $dynamicAnchor: "meta",
    title: "Content vocabulary meta-schema",
    type: ["object", "boolean"],
    properties: {
      contentEncoding: { type: "string" },
      contentMediaType: { type: "string" },
      contentSchema: { $dynamicRef: "#meta" }
    }
  };
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/refs/json-schema-2020-12/meta/core.json
var require_core3 = __commonJS((exports, module) => {
  module.exports = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://json-schema.org/draft/2020-12/meta/core",
    $vocabulary: {
      "https://json-schema.org/draft/2020-12/vocab/core": true
    },
    $dynamicAnchor: "meta",
    title: "Core vocabulary meta-schema",
    type: ["object", "boolean"],
    properties: {
      $id: {
        $ref: "#/$defs/uriReferenceString",
        $comment: "Non-empty fragments not allowed.",
        pattern: "^[^#]*#?$"
      },
      $schema: { $ref: "#/$defs/uriString" },
      $ref: { $ref: "#/$defs/uriReferenceString" },
      $anchor: { $ref: "#/$defs/anchorString" },
      $dynamicRef: { $ref: "#/$defs/uriReferenceString" },
      $dynamicAnchor: { $ref: "#/$defs/anchorString" },
      $vocabulary: {
        type: "object",
        propertyNames: { $ref: "#/$defs/uriString" },
        additionalProperties: {
          type: "boolean"
        }
      },
      $comment: {
        type: "string"
      },
      $defs: {
        type: "object",
        additionalProperties: { $dynamicRef: "#meta" }
      }
    },
    $defs: {
      anchorString: {
        type: "string",
        pattern: "^[A-Za-z_][-A-Za-z0-9._]*$"
      },
      uriString: {
        type: "string",
        format: "uri"
      },
      uriReferenceString: {
        type: "string",
        format: "uri-reference"
      }
    }
  };
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/refs/json-schema-2020-12/meta/format-annotation.json
var require_format_annotation = __commonJS((exports, module) => {
  module.exports = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://json-schema.org/draft/2020-12/meta/format-annotation",
    $vocabulary: {
      "https://json-schema.org/draft/2020-12/vocab/format-annotation": true
    },
    $dynamicAnchor: "meta",
    title: "Format vocabulary meta-schema for annotation results",
    type: ["object", "boolean"],
    properties: {
      format: { type: "string" }
    }
  };
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/refs/json-schema-2020-12/meta/meta-data.json
var require_meta_data = __commonJS((exports, module) => {
  module.exports = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://json-schema.org/draft/2020-12/meta/meta-data",
    $vocabulary: {
      "https://json-schema.org/draft/2020-12/vocab/meta-data": true
    },
    $dynamicAnchor: "meta",
    title: "Meta-data vocabulary meta-schema",
    type: ["object", "boolean"],
    properties: {
      title: {
        type: "string"
      },
      description: {
        type: "string"
      },
      default: true,
      deprecated: {
        type: "boolean",
        default: false
      },
      readOnly: {
        type: "boolean",
        default: false
      },
      writeOnly: {
        type: "boolean",
        default: false
      },
      examples: {
        type: "array",
        items: true
      }
    }
  };
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/refs/json-schema-2020-12/meta/validation.json
var require_validation2 = __commonJS((exports, module) => {
  module.exports = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://json-schema.org/draft/2020-12/meta/validation",
    $vocabulary: {
      "https://json-schema.org/draft/2020-12/vocab/validation": true
    },
    $dynamicAnchor: "meta",
    title: "Validation vocabulary meta-schema",
    type: ["object", "boolean"],
    properties: {
      type: {
        anyOf: [
          { $ref: "#/$defs/simpleTypes" },
          {
            type: "array",
            items: { $ref: "#/$defs/simpleTypes" },
            minItems: 1,
            uniqueItems: true
          }
        ]
      },
      const: true,
      enum: {
        type: "array",
        items: true
      },
      multipleOf: {
        type: "number",
        exclusiveMinimum: 0
      },
      maximum: {
        type: "number"
      },
      exclusiveMaximum: {
        type: "number"
      },
      minimum: {
        type: "number"
      },
      exclusiveMinimum: {
        type: "number"
      },
      maxLength: { $ref: "#/$defs/nonNegativeInteger" },
      minLength: { $ref: "#/$defs/nonNegativeIntegerDefault0" },
      pattern: {
        type: "string",
        format: "regex"
      },
      maxItems: { $ref: "#/$defs/nonNegativeInteger" },
      minItems: { $ref: "#/$defs/nonNegativeIntegerDefault0" },
      uniqueItems: {
        type: "boolean",
        default: false
      },
      maxContains: { $ref: "#/$defs/nonNegativeInteger" },
      minContains: {
        $ref: "#/$defs/nonNegativeInteger",
        default: 1
      },
      maxProperties: { $ref: "#/$defs/nonNegativeInteger" },
      minProperties: { $ref: "#/$defs/nonNegativeIntegerDefault0" },
      required: { $ref: "#/$defs/stringArray" },
      dependentRequired: {
        type: "object",
        additionalProperties: {
          $ref: "#/$defs/stringArray"
        }
      }
    },
    $defs: {
      nonNegativeInteger: {
        type: "integer",
        minimum: 0
      },
      nonNegativeIntegerDefault0: {
        $ref: "#/$defs/nonNegativeInteger",
        default: 0
      },
      simpleTypes: {
        enum: ["array", "boolean", "integer", "null", "number", "object", "string"]
      },
      stringArray: {
        type: "array",
        items: { type: "string" },
        uniqueItems: true,
        default: []
      }
    }
  };
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/refs/json-schema-2020-12/index.js
var require_json_schema_2020_12 = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var metaSchema = require_schema();
  var applicator = require_applicator2();
  var unevaluated = require_unevaluated2();
  var content = require_content();
  var core = require_core3();
  var format = require_format_annotation();
  var metadata = require_meta_data();
  var validation = require_validation2();
  var META_SUPPORT_DATA = ["/properties"];
  function addMetaSchema2020($data) {
    [
      metaSchema,
      applicator,
      unevaluated,
      content,
      core,
      with$data(this, format),
      metadata,
      with$data(this, validation)
    ].forEach((sch) => this.addMetaSchema(sch, undefined, false));
    return this;
    function with$data(ajv, sch) {
      return $data ? ajv.$dataMetaSchema(sch, META_SUPPORT_DATA) : sch;
    }
  }
  exports.default = addMetaSchema2020;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/2020.js
var require_2020 = __commonJS((exports, module) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.MissingRefError = exports.ValidationError = exports.CodeGen = exports.Name = exports.nil = exports.stringify = exports.str = exports._ = exports.KeywordCxt = exports.Ajv2020 = undefined;
  var core_1 = require_core();
  var draft2020_1 = require_draft2020();
  var discriminator_1 = require_discriminator();
  var json_schema_2020_12_1 = require_json_schema_2020_12();
  var META_SCHEMA_ID = "https://json-schema.org/draft/2020-12/schema";

  class Ajv2020 extends core_1.default {
    constructor(opts = {}) {
      super({
        ...opts,
        dynamicRef: true,
        next: true,
        unevaluated: true
      });
    }
    _addVocabularies() {
      super._addVocabularies();
      draft2020_1.default.forEach((v) => this.addVocabulary(v));
      if (this.opts.discriminator)
        this.addKeyword(discriminator_1.default);
    }
    _addDefaultMetaSchema() {
      super._addDefaultMetaSchema();
      const { $data, meta } = this.opts;
      if (!meta)
        return;
      json_schema_2020_12_1.default.call(this, $data);
      this.refs["http://json-schema.org/schema"] = META_SCHEMA_ID;
    }
    defaultMeta() {
      return this.opts.defaultMeta = super.defaultMeta() || (this.getSchema(META_SCHEMA_ID) ? META_SCHEMA_ID : undefined);
    }
  }
  exports.Ajv2020 = Ajv2020;
  module.exports = exports = Ajv2020;
  module.exports.Ajv2020 = Ajv2020;
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.default = Ajv2020;
  var validate_1 = require_validate();
  Object.defineProperty(exports, "KeywordCxt", { enumerable: true, get: function() {
    return validate_1.KeywordCxt;
  } });
  var codegen_1 = require_codegen();
  Object.defineProperty(exports, "_", { enumerable: true, get: function() {
    return codegen_1._;
  } });
  Object.defineProperty(exports, "str", { enumerable: true, get: function() {
    return codegen_1.str;
  } });
  Object.defineProperty(exports, "stringify", { enumerable: true, get: function() {
    return codegen_1.stringify;
  } });
  Object.defineProperty(exports, "nil", { enumerable: true, get: function() {
    return codegen_1.nil;
  } });
  Object.defineProperty(exports, "Name", { enumerable: true, get: function() {
    return codegen_1.Name;
  } });
  Object.defineProperty(exports, "CodeGen", { enumerable: true, get: function() {
    return codegen_1.CodeGen;
  } });
  var validation_error_1 = require_validation_error();
  Object.defineProperty(exports, "ValidationError", { enumerable: true, get: function() {
    return validation_error_1.default;
  } });
  var ref_error_1 = require_ref_error();
  Object.defineProperty(exports, "MissingRefError", { enumerable: true, get: function() {
    return ref_error_1.default;
  } });
});

// node_modules/.pnpm/ajv-formats@3.0.1_ajv@8.20.0/node_modules/ajv-formats/dist/formats.js
var require_formats = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.formatNames = exports.fastFormats = exports.fullFormats = undefined;
  function fmtDef(validate, compare) {
    return { validate, compare };
  }
  exports.fullFormats = {
    date: fmtDef(date, compareDate),
    time: fmtDef(getTime(true), compareTime),
    "date-time": fmtDef(getDateTime(true), compareDateTime),
    "iso-time": fmtDef(getTime(), compareIsoTime),
    "iso-date-time": fmtDef(getDateTime(), compareIsoDateTime),
    duration: /^P(?!$)((\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+S)?)?|(\d+W)?)$/,
    uri,
    "uri-reference": /^(?:[a-z][a-z0-9+\-.]*:)?(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'"()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*)?(?:\?(?:[a-z0-9\-._~!$&'"()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'"()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i,
    "uri-template": /^(?:(?:[^\x00-\x20"'<>%\\^`{|}]|%[0-9a-f]{2})|\{[+#./;?&=,!@|]?(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?(?:,(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?)*\})*$/i,
    url: /^(?:https?|ftp):\/\/(?:\S+(?::\S*)?@)?(?:(?!(?:10|127)(?:\.\d{1,3}){3})(?!(?:169\.254|192\.168)(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z0-9\u{00a1}-\u{ffff}]+-)*[a-z0-9\u{00a1}-\u{ffff}]+)(?:\.(?:[a-z0-9\u{00a1}-\u{ffff}]+-)*[a-z0-9\u{00a1}-\u{ffff}]+)*(?:\.(?:[a-z\u{00a1}-\u{ffff}]{2,})))(?::\d{2,5})?(?:\/[^\s]*)?$/iu,
    email: /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i,
    hostname: /^(?=.{1,253}\.?$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[-0-9a-z]{0,61}[0-9a-z])?)*\.?$/i,
    ipv4: /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/,
    ipv6: /^((([0-9a-f]{1,4}:){7}([0-9a-f]{1,4}|:))|(([0-9a-f]{1,4}:){6}(:[0-9a-f]{1,4}|((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){5}(((:[0-9a-f]{1,4}){1,2})|:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){4}(((:[0-9a-f]{1,4}){1,3})|((:[0-9a-f]{1,4})?:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){3}(((:[0-9a-f]{1,4}){1,4})|((:[0-9a-f]{1,4}){0,2}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){2}(((:[0-9a-f]{1,4}){1,5})|((:[0-9a-f]{1,4}){0,3}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){1}(((:[0-9a-f]{1,4}){1,6})|((:[0-9a-f]{1,4}){0,4}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(:(((:[0-9a-f]{1,4}){1,7})|((:[0-9a-f]{1,4}){0,5}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:)))$/i,
    regex,
    uuid: /^(?:urn:uuid:)?[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i,
    "json-pointer": /^(?:\/(?:[^~/]|~0|~1)*)*$/,
    "json-pointer-uri-fragment": /^#(?:\/(?:[a-z0-9_\-.!$&'()*+,;:=@]|%[0-9a-f]{2}|~0|~1)*)*$/i,
    "relative-json-pointer": /^(?:0|[1-9][0-9]*)(?:#|(?:\/(?:[^~/]|~0|~1)*)*)$/,
    byte,
    int32: { type: "number", validate: validateInt32 },
    int64: { type: "number", validate: validateInt64 },
    float: { type: "number", validate: validateNumber },
    double: { type: "number", validate: validateNumber },
    password: true,
    binary: true
  };
  exports.fastFormats = {
    ...exports.fullFormats,
    date: fmtDef(/^\d\d\d\d-[0-1]\d-[0-3]\d$/, compareDate),
    time: fmtDef(/^(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)$/i, compareTime),
    "date-time": fmtDef(/^\d\d\d\d-[0-1]\d-[0-3]\dt(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)$/i, compareDateTime),
    "iso-time": fmtDef(/^(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)?$/i, compareIsoTime),
    "iso-date-time": fmtDef(/^\d\d\d\d-[0-1]\d-[0-3]\d[t\s](?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)?$/i, compareIsoDateTime),
    uri: /^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/)?[^\s]*$/i,
    "uri-reference": /^(?:(?:[a-z][a-z0-9+\-.]*:)?\/?\/)?(?:[^\\\s#][^\s#]*)?(?:#[^\\\s]*)?$/i,
    email: /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i
  };
  exports.formatNames = Object.keys(exports.fullFormats);
  function isLeapYear(year) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  }
  var DATE = /^(\d\d\d\d)-(\d\d)-(\d\d)$/;
  var DAYS = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  function date(str) {
    const matches = DATE.exec(str);
    if (!matches)
      return false;
    const year = +matches[1];
    const month = +matches[2];
    const day = +matches[3];
    return month >= 1 && month <= 12 && day >= 1 && day <= (month === 2 && isLeapYear(year) ? 29 : DAYS[month]);
  }
  function compareDate(d1, d2) {
    if (!(d1 && d2))
      return;
    if (d1 > d2)
      return 1;
    if (d1 < d2)
      return -1;
    return 0;
  }
  var TIME = /^(\d\d):(\d\d):(\d\d(?:\.\d+)?)(z|([+-])(\d\d)(?::?(\d\d))?)?$/i;
  function getTime(strictTimeZone) {
    return function time(str) {
      const matches = TIME.exec(str);
      if (!matches)
        return false;
      const hr = +matches[1];
      const min = +matches[2];
      const sec = +matches[3];
      const tz = matches[4];
      const tzSign = matches[5] === "-" ? -1 : 1;
      const tzH = +(matches[6] || 0);
      const tzM = +(matches[7] || 0);
      if (tzH > 23 || tzM > 59 || strictTimeZone && !tz)
        return false;
      if (hr <= 23 && min <= 59 && sec < 60)
        return true;
      const utcMin = min - tzM * tzSign;
      const utcHr = hr - tzH * tzSign - (utcMin < 0 ? 1 : 0);
      return (utcHr === 23 || utcHr === -1) && (utcMin === 59 || utcMin === -1) && sec < 61;
    };
  }
  function compareTime(s1, s2) {
    if (!(s1 && s2))
      return;
    const t1 = new Date("2020-01-01T" + s1).valueOf();
    const t2 = new Date("2020-01-01T" + s2).valueOf();
    if (!(t1 && t2))
      return;
    return t1 - t2;
  }
  function compareIsoTime(t1, t2) {
    if (!(t1 && t2))
      return;
    const a1 = TIME.exec(t1);
    const a2 = TIME.exec(t2);
    if (!(a1 && a2))
      return;
    t1 = a1[1] + a1[2] + a1[3];
    t2 = a2[1] + a2[2] + a2[3];
    if (t1 > t2)
      return 1;
    if (t1 < t2)
      return -1;
    return 0;
  }
  var DATE_TIME_SEPARATOR = /t|\s/i;
  function getDateTime(strictTimeZone) {
    const time = getTime(strictTimeZone);
    return function date_time(str) {
      const dateTime = str.split(DATE_TIME_SEPARATOR);
      return dateTime.length === 2 && date(dateTime[0]) && time(dateTime[1]);
    };
  }
  function compareDateTime(dt1, dt2) {
    if (!(dt1 && dt2))
      return;
    const d1 = new Date(dt1).valueOf();
    const d2 = new Date(dt2).valueOf();
    if (!(d1 && d2))
      return;
    return d1 - d2;
  }
  function compareIsoDateTime(dt1, dt2) {
    if (!(dt1 && dt2))
      return;
    const [d1, t1] = dt1.split(DATE_TIME_SEPARATOR);
    const [d2, t2] = dt2.split(DATE_TIME_SEPARATOR);
    const res = compareDate(d1, d2);
    if (res === undefined)
      return;
    return res || compareTime(t1, t2);
  }
  var NOT_URI_FRAGMENT = /\/|:/;
  var URI = /^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)(?:\?(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i;
  function uri(str) {
    return NOT_URI_FRAGMENT.test(str) && URI.test(str);
  }
  var BYTE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/gm;
  function byte(str) {
    BYTE.lastIndex = 0;
    return BYTE.test(str);
  }
  var MIN_INT32 = -(2 ** 31);
  var MAX_INT32 = 2 ** 31 - 1;
  function validateInt32(value) {
    return Number.isInteger(value) && value <= MAX_INT32 && value >= MIN_INT32;
  }
  function validateInt64(value) {
    return Number.isInteger(value);
  }
  function validateNumber() {
    return true;
  }
  var Z_ANCHOR = /[^\\]\\Z/;
  function regex(str) {
    if (Z_ANCHOR.test(str))
      return false;
    try {
      new RegExp(str);
      return true;
    } catch (e) {
      return false;
    }
  }
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/draft7.js
var require_draft7 = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var core_1 = require_core2();
  var validation_1 = require_validation();
  var applicator_1 = require_applicator();
  var format_1 = require_format2();
  var metadata_1 = require_metadata();
  var draft7Vocabularies = [
    core_1.default,
    validation_1.default,
    (0, applicator_1.default)(),
    format_1.default,
    metadata_1.metadataVocabulary,
    metadata_1.contentVocabulary
  ];
  exports.default = draft7Vocabularies;
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/refs/json-schema-draft-07.json
var require_json_schema_draft_07 = __commonJS((exports, module) => {
  module.exports = {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: "http://json-schema.org/draft-07/schema#",
    title: "Core schema meta-schema",
    definitions: {
      schemaArray: {
        type: "array",
        minItems: 1,
        items: { $ref: "#" }
      },
      nonNegativeInteger: {
        type: "integer",
        minimum: 0
      },
      nonNegativeIntegerDefault0: {
        allOf: [{ $ref: "#/definitions/nonNegativeInteger" }, { default: 0 }]
      },
      simpleTypes: {
        enum: ["array", "boolean", "integer", "null", "number", "object", "string"]
      },
      stringArray: {
        type: "array",
        items: { type: "string" },
        uniqueItems: true,
        default: []
      }
    },
    type: ["object", "boolean"],
    properties: {
      $id: {
        type: "string",
        format: "uri-reference"
      },
      $schema: {
        type: "string",
        format: "uri"
      },
      $ref: {
        type: "string",
        format: "uri-reference"
      },
      $comment: {
        type: "string"
      },
      title: {
        type: "string"
      },
      description: {
        type: "string"
      },
      default: true,
      readOnly: {
        type: "boolean",
        default: false
      },
      examples: {
        type: "array",
        items: true
      },
      multipleOf: {
        type: "number",
        exclusiveMinimum: 0
      },
      maximum: {
        type: "number"
      },
      exclusiveMaximum: {
        type: "number"
      },
      minimum: {
        type: "number"
      },
      exclusiveMinimum: {
        type: "number"
      },
      maxLength: { $ref: "#/definitions/nonNegativeInteger" },
      minLength: { $ref: "#/definitions/nonNegativeIntegerDefault0" },
      pattern: {
        type: "string",
        format: "regex"
      },
      additionalItems: { $ref: "#" },
      items: {
        anyOf: [{ $ref: "#" }, { $ref: "#/definitions/schemaArray" }],
        default: true
      },
      maxItems: { $ref: "#/definitions/nonNegativeInteger" },
      minItems: { $ref: "#/definitions/nonNegativeIntegerDefault0" },
      uniqueItems: {
        type: "boolean",
        default: false
      },
      contains: { $ref: "#" },
      maxProperties: { $ref: "#/definitions/nonNegativeInteger" },
      minProperties: { $ref: "#/definitions/nonNegativeIntegerDefault0" },
      required: { $ref: "#/definitions/stringArray" },
      additionalProperties: { $ref: "#" },
      definitions: {
        type: "object",
        additionalProperties: { $ref: "#" },
        default: {}
      },
      properties: {
        type: "object",
        additionalProperties: { $ref: "#" },
        default: {}
      },
      patternProperties: {
        type: "object",
        additionalProperties: { $ref: "#" },
        propertyNames: { format: "regex" },
        default: {}
      },
      dependencies: {
        type: "object",
        additionalProperties: {
          anyOf: [{ $ref: "#" }, { $ref: "#/definitions/stringArray" }]
        }
      },
      propertyNames: { $ref: "#" },
      const: true,
      enum: {
        type: "array",
        items: true,
        minItems: 1,
        uniqueItems: true
      },
      type: {
        anyOf: [
          { $ref: "#/definitions/simpleTypes" },
          {
            type: "array",
            items: { $ref: "#/definitions/simpleTypes" },
            minItems: 1,
            uniqueItems: true
          }
        ]
      },
      format: { type: "string" },
      contentMediaType: { type: "string" },
      contentEncoding: { type: "string" },
      if: { $ref: "#" },
      then: { $ref: "#" },
      else: { $ref: "#" },
      allOf: { $ref: "#/definitions/schemaArray" },
      anyOf: { $ref: "#/definitions/schemaArray" },
      oneOf: { $ref: "#/definitions/schemaArray" },
      not: { $ref: "#" }
    },
    default: true
  };
});

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/ajv.js
var require_ajv = __commonJS((exports, module) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.MissingRefError = exports.ValidationError = exports.CodeGen = exports.Name = exports.nil = exports.stringify = exports.str = exports._ = exports.KeywordCxt = exports.Ajv = undefined;
  var core_1 = require_core();
  var draft7_1 = require_draft7();
  var discriminator_1 = require_discriminator();
  var draft7MetaSchema = require_json_schema_draft_07();
  var META_SUPPORT_DATA = ["/properties"];
  var META_SCHEMA_ID = "http://json-schema.org/draft-07/schema";

  class Ajv extends core_1.default {
    _addVocabularies() {
      super._addVocabularies();
      draft7_1.default.forEach((v) => this.addVocabulary(v));
      if (this.opts.discriminator)
        this.addKeyword(discriminator_1.default);
    }
    _addDefaultMetaSchema() {
      super._addDefaultMetaSchema();
      if (!this.opts.meta)
        return;
      const metaSchema = this.opts.$data ? this.$dataMetaSchema(draft7MetaSchema, META_SUPPORT_DATA) : draft7MetaSchema;
      this.addMetaSchema(metaSchema, META_SCHEMA_ID, false);
      this.refs["http://json-schema.org/schema"] = META_SCHEMA_ID;
    }
    defaultMeta() {
      return this.opts.defaultMeta = super.defaultMeta() || (this.getSchema(META_SCHEMA_ID) ? META_SCHEMA_ID : undefined);
    }
  }
  exports.Ajv = Ajv;
  module.exports = exports = Ajv;
  module.exports.Ajv = Ajv;
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.default = Ajv;
  var validate_1 = require_validate();
  Object.defineProperty(exports, "KeywordCxt", { enumerable: true, get: function() {
    return validate_1.KeywordCxt;
  } });
  var codegen_1 = require_codegen();
  Object.defineProperty(exports, "_", { enumerable: true, get: function() {
    return codegen_1._;
  } });
  Object.defineProperty(exports, "str", { enumerable: true, get: function() {
    return codegen_1.str;
  } });
  Object.defineProperty(exports, "stringify", { enumerable: true, get: function() {
    return codegen_1.stringify;
  } });
  Object.defineProperty(exports, "nil", { enumerable: true, get: function() {
    return codegen_1.nil;
  } });
  Object.defineProperty(exports, "Name", { enumerable: true, get: function() {
    return codegen_1.Name;
  } });
  Object.defineProperty(exports, "CodeGen", { enumerable: true, get: function() {
    return codegen_1.CodeGen;
  } });
  var validation_error_1 = require_validation_error();
  Object.defineProperty(exports, "ValidationError", { enumerable: true, get: function() {
    return validation_error_1.default;
  } });
  var ref_error_1 = require_ref_error();
  Object.defineProperty(exports, "MissingRefError", { enumerable: true, get: function() {
    return ref_error_1.default;
  } });
});

// node_modules/.pnpm/ajv-formats@3.0.1_ajv@8.20.0/node_modules/ajv-formats/dist/limit.js
var require_limit = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.formatLimitDefinition = undefined;
  var ajv_1 = require_ajv();
  var codegen_1 = require_codegen();
  var ops = codegen_1.operators;
  var KWDs = {
    formatMaximum: { okStr: "<=", ok: ops.LTE, fail: ops.GT },
    formatMinimum: { okStr: ">=", ok: ops.GTE, fail: ops.LT },
    formatExclusiveMaximum: { okStr: "<", ok: ops.LT, fail: ops.GTE },
    formatExclusiveMinimum: { okStr: ">", ok: ops.GT, fail: ops.LTE }
  };
  var error = {
    message: ({ keyword, schemaCode }) => (0, codegen_1.str)`should be ${KWDs[keyword].okStr} ${schemaCode}`,
    params: ({ keyword, schemaCode }) => (0, codegen_1._)`{comparison: ${KWDs[keyword].okStr}, limit: ${schemaCode}}`
  };
  exports.formatLimitDefinition = {
    keyword: Object.keys(KWDs),
    type: "string",
    schemaType: "string",
    $data: true,
    error,
    code(cxt) {
      const { gen, data, schemaCode, keyword, it } = cxt;
      const { opts, self } = it;
      if (!opts.validateFormats)
        return;
      const fCxt = new ajv_1.KeywordCxt(it, self.RULES.all.format.definition, "format");
      if (fCxt.$data)
        validate$DataFormat();
      else
        validateFormat();
      function validate$DataFormat() {
        const fmts = gen.scopeValue("formats", {
          ref: self.formats,
          code: opts.code.formats
        });
        const fmt = gen.const("fmt", (0, codegen_1._)`${fmts}[${fCxt.schemaCode}]`);
        cxt.fail$data((0, codegen_1.or)((0, codegen_1._)`typeof ${fmt} != "object"`, (0, codegen_1._)`${fmt} instanceof RegExp`, (0, codegen_1._)`typeof ${fmt}.compare != "function"`, compareCode(fmt)));
      }
      function validateFormat() {
        const format = fCxt.schema;
        const fmtDef = self.formats[format];
        if (!fmtDef || fmtDef === true)
          return;
        if (typeof fmtDef != "object" || fmtDef instanceof RegExp || typeof fmtDef.compare != "function") {
          throw new Error(`"${keyword}": format "${format}" does not define "compare" function`);
        }
        const fmt = gen.scopeValue("formats", {
          key: format,
          ref: fmtDef,
          code: opts.code.formats ? (0, codegen_1._)`${opts.code.formats}${(0, codegen_1.getProperty)(format)}` : undefined
        });
        cxt.fail$data(compareCode(fmt));
      }
      function compareCode(fmt) {
        return (0, codegen_1._)`${fmt}.compare(${data}, ${schemaCode}) ${KWDs[keyword].fail} 0`;
      }
    },
    dependencies: ["format"]
  };
  var formatLimitPlugin = (ajv) => {
    ajv.addKeyword(exports.formatLimitDefinition);
    return ajv;
  };
  exports.default = formatLimitPlugin;
});

// node_modules/.pnpm/ajv-formats@3.0.1_ajv@8.20.0/node_modules/ajv-formats/dist/index.js
var require_dist = __commonJS((exports, module) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var formats_1 = require_formats();
  var limit_1 = require_limit();
  var codegen_1 = require_codegen();
  var fullName = new codegen_1.Name("fullFormats");
  var fastName = new codegen_1.Name("fastFormats");
  var formatsPlugin = (ajv, opts = { keywords: true }) => {
    if (Array.isArray(opts)) {
      addFormats(ajv, opts, formats_1.fullFormats, fullName);
      return ajv;
    }
    const [formats, exportName] = opts.mode === "fast" ? [formats_1.fastFormats, fastName] : [formats_1.fullFormats, fullName];
    const list = opts.formats || formats_1.formatNames;
    addFormats(ajv, list, formats, exportName);
    if (opts.keywords)
      (0, limit_1.default)(ajv);
    return ajv;
  };
  formatsPlugin.get = (name, mode = "full") => {
    const formats = mode === "fast" ? formats_1.fastFormats : formats_1.fullFormats;
    const f = formats[name];
    if (!f)
      throw new Error(`Unknown format "${name}"`);
    return f;
  };
  function addFormats(ajv, list, fs, exportName) {
    var _a;
    var _b;
    (_a = (_b = ajv.opts.code).formats) !== null && _a !== undefined || (_b.formats = (0, codegen_1._)`require("ajv-formats/dist/formats").${exportName}`);
    for (const f of list)
      ajv.addFormat(f, fs[f]);
  }
  module.exports = exports = formatsPlugin;
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.default = formatsPlugin;
});

// hooks/lib/schema-io.mjs
import { readFileSync as readFileSync4 } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
function loadSchema(name) {
  if (cache.has(name))
    return cache.get(name);
  const schemaPath = resolve(SCHEMAS_DIR, `${name}.schema.json`);
  const raw = readFileSync4(schemaPath, "utf8");
  const schema = JSON.parse(raw);
  const validate = ajv.compile(schema);
  cache.set(name, validate);
  return validate;
}
function ajvErrorsToLines(errors, prefix) {
  if (!errors || errors.length === 0)
    return [];
  return errors.map((err) => {
    const field = instancePathToField(err.instancePath, prefix);
    const problem = ajvMessageToString(err);
    return `${field}: ${problem}`;
  });
}
function instancePathToField(instancePath, prefix) {
  if (!instancePath || instancePath === "/") {
    return prefix ?? "schema";
  }
  const parts = instancePath.replace(/^\//, "").split("/");
  let result = "";
  for (let i = 0;i < parts.length; i++) {
    const part = parts[i];
    if (/^\d+$/.test(part)) {
      result += `[${part}]`;
    } else if (i === 0) {
      result = part;
    } else {
      result += `.${part}`;
    }
  }
  return result;
}
function ajvMessageToString(err) {
  const msg = err.message ?? "invalid";
  const { keyword, params } = err;
  switch (keyword) {
    case "enum":
      return `${msg} \u2014 allowed: ${(params.allowedValues ?? []).join(", ")}`;
    case "pattern":
      return `${msg} (pattern: ${params.pattern})`;
    case "type":
      return `${msg} (got ${params.type})`;
    case "additionalProperties":
      return `${msg}: ${params.additionalProperty}`;
    case "required":
      return `missing required field: ${params.missingProperty}`;
    default:
      return msg;
  }
}
var import__2020, import_ajv_formats, SCHEMAS_DIR, ajv, cache;
var init_schema_io = __esm(() => {
  import__2020 = __toESM(require_2020(), 1);
  import_ajv_formats = __toESM(require_dist(), 1);
  SCHEMAS_DIR = process.env.CLAUDE_PLUGIN_ROOT ? resolve(process.env.CLAUDE_PLUGIN_ROOT, "schemas") : resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "schemas");
  ajv = new import__2020.default({ strict: true, allErrors: true });
  import_ajv_formats.default(ajv);
  cache = new Map;
});

// hooks/lib/motive-ref.mjs
function resolveMotiveSlug(motiveRef) {
  if (typeof motiveRef !== "string" || motiveRef.length === 0)
    return null;
  const match = motiveRef.match(/(?:^|[/\\])motives[/\\]([^/\\]+)/);
  if (match)
    return match[1];
  return motiveRef;
}

// node_modules/.pnpm/js-yaml@4.1.1/node_modules/js-yaml/dist/js-yaml.mjs
function isNothing(subject) {
  return typeof subject === "undefined" || subject === null;
}
function isObject(subject) {
  return typeof subject === "object" && subject !== null;
}
function toArray(sequence) {
  if (Array.isArray(sequence))
    return sequence;
  else if (isNothing(sequence))
    return [];
  return [sequence];
}
function extend(target, source) {
  var index, length, key, sourceKeys;
  if (source) {
    sourceKeys = Object.keys(source);
    for (index = 0, length = sourceKeys.length;index < length; index += 1) {
      key = sourceKeys[index];
      target[key] = source[key];
    }
  }
  return target;
}
function repeat(string, count) {
  var result = "", cycle;
  for (cycle = 0;cycle < count; cycle += 1) {
    result += string;
  }
  return result;
}
function isNegativeZero(number) {
  return number === 0 && Number.NEGATIVE_INFINITY === 1 / number;
}
function formatError(exception, compact) {
  var where = "", message = exception.reason || "(unknown reason)";
  if (!exception.mark)
    return message;
  if (exception.mark.name) {
    where += 'in "' + exception.mark.name + '" ';
  }
  where += "(" + (exception.mark.line + 1) + ":" + (exception.mark.column + 1) + ")";
  if (!compact && exception.mark.snippet) {
    where += `

` + exception.mark.snippet;
  }
  return message + " " + where;
}
function YAMLException$1(reason, mark) {
  Error.call(this);
  this.name = "YAMLException";
  this.reason = reason;
  this.mark = mark;
  this.message = formatError(this, false);
  if (Error.captureStackTrace) {
    Error.captureStackTrace(this, this.constructor);
  } else {
    this.stack = new Error().stack || "";
  }
}
function getLine(buffer, lineStart, lineEnd, position, maxLineLength) {
  var head = "";
  var tail = "";
  var maxHalfLength = Math.floor(maxLineLength / 2) - 1;
  if (position - lineStart > maxHalfLength) {
    head = " ... ";
    lineStart = position - maxHalfLength + head.length;
  }
  if (lineEnd - position > maxHalfLength) {
    tail = " ...";
    lineEnd = position + maxHalfLength - tail.length;
  }
  return {
    str: head + buffer.slice(lineStart, lineEnd).replace(/\t/g, "\u2192") + tail,
    pos: position - lineStart + head.length
  };
}
function padStart(string, max) {
  return common.repeat(" ", max - string.length) + string;
}
function makeSnippet(mark, options) {
  options = Object.create(options || null);
  if (!mark.buffer)
    return null;
  if (!options.maxLength)
    options.maxLength = 79;
  if (typeof options.indent !== "number")
    options.indent = 1;
  if (typeof options.linesBefore !== "number")
    options.linesBefore = 3;
  if (typeof options.linesAfter !== "number")
    options.linesAfter = 2;
  var re = /\r?\n|\r|\0/g;
  var lineStarts = [0];
  var lineEnds = [];
  var match;
  var foundLineNo = -1;
  while (match = re.exec(mark.buffer)) {
    lineEnds.push(match.index);
    lineStarts.push(match.index + match[0].length);
    if (mark.position <= match.index && foundLineNo < 0) {
      foundLineNo = lineStarts.length - 2;
    }
  }
  if (foundLineNo < 0)
    foundLineNo = lineStarts.length - 1;
  var result = "", i, line;
  var lineNoLength = Math.min(mark.line + options.linesAfter, lineEnds.length).toString().length;
  var maxLineLength = options.maxLength - (options.indent + lineNoLength + 3);
  for (i = 1;i <= options.linesBefore; i++) {
    if (foundLineNo - i < 0)
      break;
    line = getLine(mark.buffer, lineStarts[foundLineNo - i], lineEnds[foundLineNo - i], mark.position - (lineStarts[foundLineNo] - lineStarts[foundLineNo - i]), maxLineLength);
    result = common.repeat(" ", options.indent) + padStart((mark.line - i + 1).toString(), lineNoLength) + " | " + line.str + `
` + result;
  }
  line = getLine(mark.buffer, lineStarts[foundLineNo], lineEnds[foundLineNo], mark.position, maxLineLength);
  result += common.repeat(" ", options.indent) + padStart((mark.line + 1).toString(), lineNoLength) + " | " + line.str + `
`;
  result += common.repeat("-", options.indent + lineNoLength + 3 + line.pos) + "^" + `
`;
  for (i = 1;i <= options.linesAfter; i++) {
    if (foundLineNo + i >= lineEnds.length)
      break;
    line = getLine(mark.buffer, lineStarts[foundLineNo + i], lineEnds[foundLineNo + i], mark.position - (lineStarts[foundLineNo] - lineStarts[foundLineNo + i]), maxLineLength);
    result += common.repeat(" ", options.indent) + padStart((mark.line + i + 1).toString(), lineNoLength) + " | " + line.str + `
`;
  }
  return result.replace(/\n$/, "");
}
function compileStyleAliases(map) {
  var result = {};
  if (map !== null) {
    Object.keys(map).forEach(function(style) {
      map[style].forEach(function(alias) {
        result[String(alias)] = style;
      });
    });
  }
  return result;
}
function Type$1(tag, options) {
  options = options || {};
  Object.keys(options).forEach(function(name) {
    if (TYPE_CONSTRUCTOR_OPTIONS.indexOf(name) === -1) {
      throw new exception('Unknown option "' + name + '" is met in definition of "' + tag + '" YAML type.');
    }
  });
  this.options = options;
  this.tag = tag;
  this.kind = options["kind"] || null;
  this.resolve = options["resolve"] || function() {
    return true;
  };
  this.construct = options["construct"] || function(data) {
    return data;
  };
  this.instanceOf = options["instanceOf"] || null;
  this.predicate = options["predicate"] || null;
  this.represent = options["represent"] || null;
  this.representName = options["representName"] || null;
  this.defaultStyle = options["defaultStyle"] || null;
  this.multi = options["multi"] || false;
  this.styleAliases = compileStyleAliases(options["styleAliases"] || null);
  if (YAML_NODE_KINDS.indexOf(this.kind) === -1) {
    throw new exception('Unknown kind "' + this.kind + '" is specified for "' + tag + '" YAML type.');
  }
}
function compileList(schema, name) {
  var result = [];
  schema[name].forEach(function(currentType) {
    var newIndex = result.length;
    result.forEach(function(previousType, previousIndex) {
      if (previousType.tag === currentType.tag && previousType.kind === currentType.kind && previousType.multi === currentType.multi) {
        newIndex = previousIndex;
      }
    });
    result[newIndex] = currentType;
  });
  return result;
}
function compileMap() {
  var result = {
    scalar: {},
    sequence: {},
    mapping: {},
    fallback: {},
    multi: {
      scalar: [],
      sequence: [],
      mapping: [],
      fallback: []
    }
  }, index, length;
  function collectType(type2) {
    if (type2.multi) {
      result.multi[type2.kind].push(type2);
      result.multi["fallback"].push(type2);
    } else {
      result[type2.kind][type2.tag] = result["fallback"][type2.tag] = type2;
    }
  }
  for (index = 0, length = arguments.length;index < length; index += 1) {
    arguments[index].forEach(collectType);
  }
  return result;
}
function Schema$1(definition) {
  return this.extend(definition);
}
function resolveYamlNull(data) {
  if (data === null)
    return true;
  var max = data.length;
  return max === 1 && data === "~" || max === 4 && (data === "null" || data === "Null" || data === "NULL");
}
function constructYamlNull() {
  return null;
}
function isNull(object) {
  return object === null;
}
function resolveYamlBoolean(data) {
  if (data === null)
    return false;
  var max = data.length;
  return max === 4 && (data === "true" || data === "True" || data === "TRUE") || max === 5 && (data === "false" || data === "False" || data === "FALSE");
}
function constructYamlBoolean(data) {
  return data === "true" || data === "True" || data === "TRUE";
}
function isBoolean(object) {
  return Object.prototype.toString.call(object) === "[object Boolean]";
}
function isHexCode(c) {
  return 48 <= c && c <= 57 || 65 <= c && c <= 70 || 97 <= c && c <= 102;
}
function isOctCode(c) {
  return 48 <= c && c <= 55;
}
function isDecCode(c) {
  return 48 <= c && c <= 57;
}
function resolveYamlInteger(data) {
  if (data === null)
    return false;
  var max = data.length, index = 0, hasDigits = false, ch;
  if (!max)
    return false;
  ch = data[index];
  if (ch === "-" || ch === "+") {
    ch = data[++index];
  }
  if (ch === "0") {
    if (index + 1 === max)
      return true;
    ch = data[++index];
    if (ch === "b") {
      index++;
      for (;index < max; index++) {
        ch = data[index];
        if (ch === "_")
          continue;
        if (ch !== "0" && ch !== "1")
          return false;
        hasDigits = true;
      }
      return hasDigits && ch !== "_";
    }
    if (ch === "x") {
      index++;
      for (;index < max; index++) {
        ch = data[index];
        if (ch === "_")
          continue;
        if (!isHexCode(data.charCodeAt(index)))
          return false;
        hasDigits = true;
      }
      return hasDigits && ch !== "_";
    }
    if (ch === "o") {
      index++;
      for (;index < max; index++) {
        ch = data[index];
        if (ch === "_")
          continue;
        if (!isOctCode(data.charCodeAt(index)))
          return false;
        hasDigits = true;
      }
      return hasDigits && ch !== "_";
    }
  }
  if (ch === "_")
    return false;
  for (;index < max; index++) {
    ch = data[index];
    if (ch === "_")
      continue;
    if (!isDecCode(data.charCodeAt(index))) {
      return false;
    }
    hasDigits = true;
  }
  if (!hasDigits || ch === "_")
    return false;
  return true;
}
function constructYamlInteger(data) {
  var value = data, sign = 1, ch;
  if (value.indexOf("_") !== -1) {
    value = value.replace(/_/g, "");
  }
  ch = value[0];
  if (ch === "-" || ch === "+") {
    if (ch === "-")
      sign = -1;
    value = value.slice(1);
    ch = value[0];
  }
  if (value === "0")
    return 0;
  if (ch === "0") {
    if (value[1] === "b")
      return sign * parseInt(value.slice(2), 2);
    if (value[1] === "x")
      return sign * parseInt(value.slice(2), 16);
    if (value[1] === "o")
      return sign * parseInt(value.slice(2), 8);
  }
  return sign * parseInt(value, 10);
}
function isInteger(object) {
  return Object.prototype.toString.call(object) === "[object Number]" && (object % 1 === 0 && !common.isNegativeZero(object));
}
function resolveYamlFloat(data) {
  if (data === null)
    return false;
  if (!YAML_FLOAT_PATTERN.test(data) || data[data.length - 1] === "_") {
    return false;
  }
  return true;
}
function constructYamlFloat(data) {
  var value, sign;
  value = data.replace(/_/g, "").toLowerCase();
  sign = value[0] === "-" ? -1 : 1;
  if ("+-".indexOf(value[0]) >= 0) {
    value = value.slice(1);
  }
  if (value === ".inf") {
    return sign === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  } else if (value === ".nan") {
    return NaN;
  }
  return sign * parseFloat(value, 10);
}
function representYamlFloat(object, style) {
  var res;
  if (isNaN(object)) {
    switch (style) {
      case "lowercase":
        return ".nan";
      case "uppercase":
        return ".NAN";
      case "camelcase":
        return ".NaN";
    }
  } else if (Number.POSITIVE_INFINITY === object) {
    switch (style) {
      case "lowercase":
        return ".inf";
      case "uppercase":
        return ".INF";
      case "camelcase":
        return ".Inf";
    }
  } else if (Number.NEGATIVE_INFINITY === object) {
    switch (style) {
      case "lowercase":
        return "-.inf";
      case "uppercase":
        return "-.INF";
      case "camelcase":
        return "-.Inf";
    }
  } else if (common.isNegativeZero(object)) {
    return "-0.0";
  }
  res = object.toString(10);
  return SCIENTIFIC_WITHOUT_DOT.test(res) ? res.replace("e", ".e") : res;
}
function isFloat(object) {
  return Object.prototype.toString.call(object) === "[object Number]" && (object % 1 !== 0 || common.isNegativeZero(object));
}
function resolveYamlTimestamp(data) {
  if (data === null)
    return false;
  if (YAML_DATE_REGEXP.exec(data) !== null)
    return true;
  if (YAML_TIMESTAMP_REGEXP.exec(data) !== null)
    return true;
  return false;
}
function constructYamlTimestamp(data) {
  var match, year, month, day, hour, minute, second, fraction = 0, delta = null, tz_hour, tz_minute, date;
  match = YAML_DATE_REGEXP.exec(data);
  if (match === null)
    match = YAML_TIMESTAMP_REGEXP.exec(data);
  if (match === null)
    throw new Error("Date resolve error");
  year = +match[1];
  month = +match[2] - 1;
  day = +match[3];
  if (!match[4]) {
    return new Date(Date.UTC(year, month, day));
  }
  hour = +match[4];
  minute = +match[5];
  second = +match[6];
  if (match[7]) {
    fraction = match[7].slice(0, 3);
    while (fraction.length < 3) {
      fraction += "0";
    }
    fraction = +fraction;
  }
  if (match[9]) {
    tz_hour = +match[10];
    tz_minute = +(match[11] || 0);
    delta = (tz_hour * 60 + tz_minute) * 60000;
    if (match[9] === "-")
      delta = -delta;
  }
  date = new Date(Date.UTC(year, month, day, hour, minute, second, fraction));
  if (delta)
    date.setTime(date.getTime() - delta);
  return date;
}
function representYamlTimestamp(object) {
  return object.toISOString();
}
function resolveYamlMerge(data) {
  return data === "<<" || data === null;
}
function resolveYamlBinary(data) {
  if (data === null)
    return false;
  var code, idx, bitlen = 0, max = data.length, map2 = BASE64_MAP;
  for (idx = 0;idx < max; idx++) {
    code = map2.indexOf(data.charAt(idx));
    if (code > 64)
      continue;
    if (code < 0)
      return false;
    bitlen += 6;
  }
  return bitlen % 8 === 0;
}
function constructYamlBinary(data) {
  var idx, tailbits, input = data.replace(/[\r\n=]/g, ""), max = input.length, map2 = BASE64_MAP, bits = 0, result = [];
  for (idx = 0;idx < max; idx++) {
    if (idx % 4 === 0 && idx) {
      result.push(bits >> 16 & 255);
      result.push(bits >> 8 & 255);
      result.push(bits & 255);
    }
    bits = bits << 6 | map2.indexOf(input.charAt(idx));
  }
  tailbits = max % 4 * 6;
  if (tailbits === 0) {
    result.push(bits >> 16 & 255);
    result.push(bits >> 8 & 255);
    result.push(bits & 255);
  } else if (tailbits === 18) {
    result.push(bits >> 10 & 255);
    result.push(bits >> 2 & 255);
  } else if (tailbits === 12) {
    result.push(bits >> 4 & 255);
  }
  return new Uint8Array(result);
}
function representYamlBinary(object) {
  var result = "", bits = 0, idx, tail, max = object.length, map2 = BASE64_MAP;
  for (idx = 0;idx < max; idx++) {
    if (idx % 3 === 0 && idx) {
      result += map2[bits >> 18 & 63];
      result += map2[bits >> 12 & 63];
      result += map2[bits >> 6 & 63];
      result += map2[bits & 63];
    }
    bits = (bits << 8) + object[idx];
  }
  tail = max % 3;
  if (tail === 0) {
    result += map2[bits >> 18 & 63];
    result += map2[bits >> 12 & 63];
    result += map2[bits >> 6 & 63];
    result += map2[bits & 63];
  } else if (tail === 2) {
    result += map2[bits >> 10 & 63];
    result += map2[bits >> 4 & 63];
    result += map2[bits << 2 & 63];
    result += map2[64];
  } else if (tail === 1) {
    result += map2[bits >> 2 & 63];
    result += map2[bits << 4 & 63];
    result += map2[64];
    result += map2[64];
  }
  return result;
}
function isBinary(obj) {
  return Object.prototype.toString.call(obj) === "[object Uint8Array]";
}
function resolveYamlOmap(data) {
  if (data === null)
    return true;
  var objectKeys = [], index, length, pair, pairKey, pairHasKey, object = data;
  for (index = 0, length = object.length;index < length; index += 1) {
    pair = object[index];
    pairHasKey = false;
    if (_toString$2.call(pair) !== "[object Object]")
      return false;
    for (pairKey in pair) {
      if (_hasOwnProperty$3.call(pair, pairKey)) {
        if (!pairHasKey)
          pairHasKey = true;
        else
          return false;
      }
    }
    if (!pairHasKey)
      return false;
    if (objectKeys.indexOf(pairKey) === -1)
      objectKeys.push(pairKey);
    else
      return false;
  }
  return true;
}
function constructYamlOmap(data) {
  return data !== null ? data : [];
}
function resolveYamlPairs(data) {
  if (data === null)
    return true;
  var index, length, pair, keys, result, object = data;
  result = new Array(object.length);
  for (index = 0, length = object.length;index < length; index += 1) {
    pair = object[index];
    if (_toString$1.call(pair) !== "[object Object]")
      return false;
    keys = Object.keys(pair);
    if (keys.length !== 1)
      return false;
    result[index] = [keys[0], pair[keys[0]]];
  }
  return true;
}
function constructYamlPairs(data) {
  if (data === null)
    return [];
  var index, length, pair, keys, result, object = data;
  result = new Array(object.length);
  for (index = 0, length = object.length;index < length; index += 1) {
    pair = object[index];
    keys = Object.keys(pair);
    result[index] = [keys[0], pair[keys[0]]];
  }
  return result;
}
function resolveYamlSet(data) {
  if (data === null)
    return true;
  var key, object = data;
  for (key in object) {
    if (_hasOwnProperty$2.call(object, key)) {
      if (object[key] !== null)
        return false;
    }
  }
  return true;
}
function constructYamlSet(data) {
  return data !== null ? data : {};
}
function _class(obj) {
  return Object.prototype.toString.call(obj);
}
function is_EOL(c) {
  return c === 10 || c === 13;
}
function is_WHITE_SPACE(c) {
  return c === 9 || c === 32;
}
function is_WS_OR_EOL(c) {
  return c === 9 || c === 32 || c === 10 || c === 13;
}
function is_FLOW_INDICATOR(c) {
  return c === 44 || c === 91 || c === 93 || c === 123 || c === 125;
}
function fromHexCode(c) {
  var lc;
  if (48 <= c && c <= 57) {
    return c - 48;
  }
  lc = c | 32;
  if (97 <= lc && lc <= 102) {
    return lc - 97 + 10;
  }
  return -1;
}
function escapedHexLen(c) {
  if (c === 120) {
    return 2;
  }
  if (c === 117) {
    return 4;
  }
  if (c === 85) {
    return 8;
  }
  return 0;
}
function fromDecimalCode(c) {
  if (48 <= c && c <= 57) {
    return c - 48;
  }
  return -1;
}
function simpleEscapeSequence(c) {
  return c === 48 ? "\x00" : c === 97 ? "\x07" : c === 98 ? "\b" : c === 116 ? "\t" : c === 9 ? "\t" : c === 110 ? `
` : c === 118 ? "\v" : c === 102 ? "\f" : c === 114 ? "\r" : c === 101 ? "\x1B" : c === 32 ? " " : c === 34 ? '"' : c === 47 ? "/" : c === 92 ? "\\" : c === 78 ? "\x85" : c === 95 ? "\xA0" : c === 76 ? "\u2028" : c === 80 ? "\u2029" : "";
}
function charFromCodepoint(c) {
  if (c <= 65535) {
    return String.fromCharCode(c);
  }
  return String.fromCharCode((c - 65536 >> 10) + 55296, (c - 65536 & 1023) + 56320);
}
function setProperty(object, key, value) {
  if (key === "__proto__") {
    Object.defineProperty(object, key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value
    });
  } else {
    object[key] = value;
  }
}
function State$1(input, options) {
  this.input = input;
  this.filename = options["filename"] || null;
  this.schema = options["schema"] || _default;
  this.onWarning = options["onWarning"] || null;
  this.legacy = options["legacy"] || false;
  this.json = options["json"] || false;
  this.listener = options["listener"] || null;
  this.implicitTypes = this.schema.compiledImplicit;
  this.typeMap = this.schema.compiledTypeMap;
  this.length = input.length;
  this.position = 0;
  this.line = 0;
  this.lineStart = 0;
  this.lineIndent = 0;
  this.firstTabInLine = -1;
  this.documents = [];
}
function generateError(state, message) {
  var mark = {
    name: state.filename,
    buffer: state.input.slice(0, -1),
    position: state.position,
    line: state.line,
    column: state.position - state.lineStart
  };
  mark.snippet = snippet(mark);
  return new exception(message, mark);
}
function throwError(state, message) {
  throw generateError(state, message);
}
function throwWarning(state, message) {
  if (state.onWarning) {
    state.onWarning.call(null, generateError(state, message));
  }
}
function captureSegment(state, start, end, checkJson) {
  var _position, _length, _character, _result;
  if (start < end) {
    _result = state.input.slice(start, end);
    if (checkJson) {
      for (_position = 0, _length = _result.length;_position < _length; _position += 1) {
        _character = _result.charCodeAt(_position);
        if (!(_character === 9 || 32 <= _character && _character <= 1114111)) {
          throwError(state, "expected valid JSON character");
        }
      }
    } else if (PATTERN_NON_PRINTABLE.test(_result)) {
      throwError(state, "the stream contains non-printable characters");
    }
    state.result += _result;
  }
}
function mergeMappings(state, destination, source, overridableKeys) {
  var sourceKeys, key, index, quantity;
  if (!common.isObject(source)) {
    throwError(state, "cannot merge mappings; the provided source object is unacceptable");
  }
  sourceKeys = Object.keys(source);
  for (index = 0, quantity = sourceKeys.length;index < quantity; index += 1) {
    key = sourceKeys[index];
    if (!_hasOwnProperty$1.call(destination, key)) {
      setProperty(destination, key, source[key]);
      overridableKeys[key] = true;
    }
  }
}
function storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, startLine, startLineStart, startPos) {
  var index, quantity;
  if (Array.isArray(keyNode)) {
    keyNode = Array.prototype.slice.call(keyNode);
    for (index = 0, quantity = keyNode.length;index < quantity; index += 1) {
      if (Array.isArray(keyNode[index])) {
        throwError(state, "nested arrays are not supported inside keys");
      }
      if (typeof keyNode === "object" && _class(keyNode[index]) === "[object Object]") {
        keyNode[index] = "[object Object]";
      }
    }
  }
  if (typeof keyNode === "object" && _class(keyNode) === "[object Object]") {
    keyNode = "[object Object]";
  }
  keyNode = String(keyNode);
  if (_result === null) {
    _result = {};
  }
  if (keyTag === "tag:yaml.org,2002:merge") {
    if (Array.isArray(valueNode)) {
      for (index = 0, quantity = valueNode.length;index < quantity; index += 1) {
        mergeMappings(state, _result, valueNode[index], overridableKeys);
      }
    } else {
      mergeMappings(state, _result, valueNode, overridableKeys);
    }
  } else {
    if (!state.json && !_hasOwnProperty$1.call(overridableKeys, keyNode) && _hasOwnProperty$1.call(_result, keyNode)) {
      state.line = startLine || state.line;
      state.lineStart = startLineStart || state.lineStart;
      state.position = startPos || state.position;
      throwError(state, "duplicated mapping key");
    }
    setProperty(_result, keyNode, valueNode);
    delete overridableKeys[keyNode];
  }
  return _result;
}
function readLineBreak(state) {
  var ch;
  ch = state.input.charCodeAt(state.position);
  if (ch === 10) {
    state.position++;
  } else if (ch === 13) {
    state.position++;
    if (state.input.charCodeAt(state.position) === 10) {
      state.position++;
    }
  } else {
    throwError(state, "a line break is expected");
  }
  state.line += 1;
  state.lineStart = state.position;
  state.firstTabInLine = -1;
}
function skipSeparationSpace(state, allowComments, checkIndent) {
  var lineBreaks = 0, ch = state.input.charCodeAt(state.position);
  while (ch !== 0) {
    while (is_WHITE_SPACE(ch)) {
      if (ch === 9 && state.firstTabInLine === -1) {
        state.firstTabInLine = state.position;
      }
      ch = state.input.charCodeAt(++state.position);
    }
    if (allowComments && ch === 35) {
      do {
        ch = state.input.charCodeAt(++state.position);
      } while (ch !== 10 && ch !== 13 && ch !== 0);
    }
    if (is_EOL(ch)) {
      readLineBreak(state);
      ch = state.input.charCodeAt(state.position);
      lineBreaks++;
      state.lineIndent = 0;
      while (ch === 32) {
        state.lineIndent++;
        ch = state.input.charCodeAt(++state.position);
      }
    } else {
      break;
    }
  }
  if (checkIndent !== -1 && lineBreaks !== 0 && state.lineIndent < checkIndent) {
    throwWarning(state, "deficient indentation");
  }
  return lineBreaks;
}
function testDocumentSeparator(state) {
  var _position = state.position, ch;
  ch = state.input.charCodeAt(_position);
  if ((ch === 45 || ch === 46) && ch === state.input.charCodeAt(_position + 1) && ch === state.input.charCodeAt(_position + 2)) {
    _position += 3;
    ch = state.input.charCodeAt(_position);
    if (ch === 0 || is_WS_OR_EOL(ch)) {
      return true;
    }
  }
  return false;
}
function writeFoldedLines(state, count) {
  if (count === 1) {
    state.result += " ";
  } else if (count > 1) {
    state.result += common.repeat(`
`, count - 1);
  }
}
function readPlainScalar(state, nodeIndent, withinFlowCollection) {
  var preceding, following, captureStart, captureEnd, hasPendingContent, _line, _lineStart, _lineIndent, _kind = state.kind, _result = state.result, ch;
  ch = state.input.charCodeAt(state.position);
  if (is_WS_OR_EOL(ch) || is_FLOW_INDICATOR(ch) || ch === 35 || ch === 38 || ch === 42 || ch === 33 || ch === 124 || ch === 62 || ch === 39 || ch === 34 || ch === 37 || ch === 64 || ch === 96) {
    return false;
  }
  if (ch === 63 || ch === 45) {
    following = state.input.charCodeAt(state.position + 1);
    if (is_WS_OR_EOL(following) || withinFlowCollection && is_FLOW_INDICATOR(following)) {
      return false;
    }
  }
  state.kind = "scalar";
  state.result = "";
  captureStart = captureEnd = state.position;
  hasPendingContent = false;
  while (ch !== 0) {
    if (ch === 58) {
      following = state.input.charCodeAt(state.position + 1);
      if (is_WS_OR_EOL(following) || withinFlowCollection && is_FLOW_INDICATOR(following)) {
        break;
      }
    } else if (ch === 35) {
      preceding = state.input.charCodeAt(state.position - 1);
      if (is_WS_OR_EOL(preceding)) {
        break;
      }
    } else if (state.position === state.lineStart && testDocumentSeparator(state) || withinFlowCollection && is_FLOW_INDICATOR(ch)) {
      break;
    } else if (is_EOL(ch)) {
      _line = state.line;
      _lineStart = state.lineStart;
      _lineIndent = state.lineIndent;
      skipSeparationSpace(state, false, -1);
      if (state.lineIndent >= nodeIndent) {
        hasPendingContent = true;
        ch = state.input.charCodeAt(state.position);
        continue;
      } else {
        state.position = captureEnd;
        state.line = _line;
        state.lineStart = _lineStart;
        state.lineIndent = _lineIndent;
        break;
      }
    }
    if (hasPendingContent) {
      captureSegment(state, captureStart, captureEnd, false);
      writeFoldedLines(state, state.line - _line);
      captureStart = captureEnd = state.position;
      hasPendingContent = false;
    }
    if (!is_WHITE_SPACE(ch)) {
      captureEnd = state.position + 1;
    }
    ch = state.input.charCodeAt(++state.position);
  }
  captureSegment(state, captureStart, captureEnd, false);
  if (state.result) {
    return true;
  }
  state.kind = _kind;
  state.result = _result;
  return false;
}
function readSingleQuotedScalar(state, nodeIndent) {
  var ch, captureStart, captureEnd;
  ch = state.input.charCodeAt(state.position);
  if (ch !== 39) {
    return false;
  }
  state.kind = "scalar";
  state.result = "";
  state.position++;
  captureStart = captureEnd = state.position;
  while ((ch = state.input.charCodeAt(state.position)) !== 0) {
    if (ch === 39) {
      captureSegment(state, captureStart, state.position, true);
      ch = state.input.charCodeAt(++state.position);
      if (ch === 39) {
        captureStart = state.position;
        state.position++;
        captureEnd = state.position;
      } else {
        return true;
      }
    } else if (is_EOL(ch)) {
      captureSegment(state, captureStart, captureEnd, true);
      writeFoldedLines(state, skipSeparationSpace(state, false, nodeIndent));
      captureStart = captureEnd = state.position;
    } else if (state.position === state.lineStart && testDocumentSeparator(state)) {
      throwError(state, "unexpected end of the document within a single quoted scalar");
    } else {
      state.position++;
      captureEnd = state.position;
    }
  }
  throwError(state, "unexpected end of the stream within a single quoted scalar");
}
function readDoubleQuotedScalar(state, nodeIndent) {
  var captureStart, captureEnd, hexLength, hexResult, tmp, ch;
  ch = state.input.charCodeAt(state.position);
  if (ch !== 34) {
    return false;
  }
  state.kind = "scalar";
  state.result = "";
  state.position++;
  captureStart = captureEnd = state.position;
  while ((ch = state.input.charCodeAt(state.position)) !== 0) {
    if (ch === 34) {
      captureSegment(state, captureStart, state.position, true);
      state.position++;
      return true;
    } else if (ch === 92) {
      captureSegment(state, captureStart, state.position, true);
      ch = state.input.charCodeAt(++state.position);
      if (is_EOL(ch)) {
        skipSeparationSpace(state, false, nodeIndent);
      } else if (ch < 256 && simpleEscapeCheck[ch]) {
        state.result += simpleEscapeMap[ch];
        state.position++;
      } else if ((tmp = escapedHexLen(ch)) > 0) {
        hexLength = tmp;
        hexResult = 0;
        for (;hexLength > 0; hexLength--) {
          ch = state.input.charCodeAt(++state.position);
          if ((tmp = fromHexCode(ch)) >= 0) {
            hexResult = (hexResult << 4) + tmp;
          } else {
            throwError(state, "expected hexadecimal character");
          }
        }
        state.result += charFromCodepoint(hexResult);
        state.position++;
      } else {
        throwError(state, "unknown escape sequence");
      }
      captureStart = captureEnd = state.position;
    } else if (is_EOL(ch)) {
      captureSegment(state, captureStart, captureEnd, true);
      writeFoldedLines(state, skipSeparationSpace(state, false, nodeIndent));
      captureStart = captureEnd = state.position;
    } else if (state.position === state.lineStart && testDocumentSeparator(state)) {
      throwError(state, "unexpected end of the document within a double quoted scalar");
    } else {
      state.position++;
      captureEnd = state.position;
    }
  }
  throwError(state, "unexpected end of the stream within a double quoted scalar");
}
function readFlowCollection(state, nodeIndent) {
  var readNext = true, _line, _lineStart, _pos, _tag = state.tag, _result, _anchor = state.anchor, following, terminator, isPair, isExplicitPair, isMapping, overridableKeys = Object.create(null), keyNode, keyTag, valueNode, ch;
  ch = state.input.charCodeAt(state.position);
  if (ch === 91) {
    terminator = 93;
    isMapping = false;
    _result = [];
  } else if (ch === 123) {
    terminator = 125;
    isMapping = true;
    _result = {};
  } else {
    return false;
  }
  if (state.anchor !== null) {
    state.anchorMap[state.anchor] = _result;
  }
  ch = state.input.charCodeAt(++state.position);
  while (ch !== 0) {
    skipSeparationSpace(state, true, nodeIndent);
    ch = state.input.charCodeAt(state.position);
    if (ch === terminator) {
      state.position++;
      state.tag = _tag;
      state.anchor = _anchor;
      state.kind = isMapping ? "mapping" : "sequence";
      state.result = _result;
      return true;
    } else if (!readNext) {
      throwError(state, "missed comma between flow collection entries");
    } else if (ch === 44) {
      throwError(state, "expected the node content, but found ','");
    }
    keyTag = keyNode = valueNode = null;
    isPair = isExplicitPair = false;
    if (ch === 63) {
      following = state.input.charCodeAt(state.position + 1);
      if (is_WS_OR_EOL(following)) {
        isPair = isExplicitPair = true;
        state.position++;
        skipSeparationSpace(state, true, nodeIndent);
      }
    }
    _line = state.line;
    _lineStart = state.lineStart;
    _pos = state.position;
    composeNode(state, nodeIndent, CONTEXT_FLOW_IN, false, true);
    keyTag = state.tag;
    keyNode = state.result;
    skipSeparationSpace(state, true, nodeIndent);
    ch = state.input.charCodeAt(state.position);
    if ((isExplicitPair || state.line === _line) && ch === 58) {
      isPair = true;
      ch = state.input.charCodeAt(++state.position);
      skipSeparationSpace(state, true, nodeIndent);
      composeNode(state, nodeIndent, CONTEXT_FLOW_IN, false, true);
      valueNode = state.result;
    }
    if (isMapping) {
      storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, _line, _lineStart, _pos);
    } else if (isPair) {
      _result.push(storeMappingPair(state, null, overridableKeys, keyTag, keyNode, valueNode, _line, _lineStart, _pos));
    } else {
      _result.push(keyNode);
    }
    skipSeparationSpace(state, true, nodeIndent);
    ch = state.input.charCodeAt(state.position);
    if (ch === 44) {
      readNext = true;
      ch = state.input.charCodeAt(++state.position);
    } else {
      readNext = false;
    }
  }
  throwError(state, "unexpected end of the stream within a flow collection");
}
function readBlockScalar(state, nodeIndent) {
  var captureStart, folding, chomping = CHOMPING_CLIP, didReadContent = false, detectedIndent = false, textIndent = nodeIndent, emptyLines = 0, atMoreIndented = false, tmp, ch;
  ch = state.input.charCodeAt(state.position);
  if (ch === 124) {
    folding = false;
  } else if (ch === 62) {
    folding = true;
  } else {
    return false;
  }
  state.kind = "scalar";
  state.result = "";
  while (ch !== 0) {
    ch = state.input.charCodeAt(++state.position);
    if (ch === 43 || ch === 45) {
      if (CHOMPING_CLIP === chomping) {
        chomping = ch === 43 ? CHOMPING_KEEP : CHOMPING_STRIP;
      } else {
        throwError(state, "repeat of a chomping mode identifier");
      }
    } else if ((tmp = fromDecimalCode(ch)) >= 0) {
      if (tmp === 0) {
        throwError(state, "bad explicit indentation width of a block scalar; it cannot be less than one");
      } else if (!detectedIndent) {
        textIndent = nodeIndent + tmp - 1;
        detectedIndent = true;
      } else {
        throwError(state, "repeat of an indentation width identifier");
      }
    } else {
      break;
    }
  }
  if (is_WHITE_SPACE(ch)) {
    do {
      ch = state.input.charCodeAt(++state.position);
    } while (is_WHITE_SPACE(ch));
    if (ch === 35) {
      do {
        ch = state.input.charCodeAt(++state.position);
      } while (!is_EOL(ch) && ch !== 0);
    }
  }
  while (ch !== 0) {
    readLineBreak(state);
    state.lineIndent = 0;
    ch = state.input.charCodeAt(state.position);
    while ((!detectedIndent || state.lineIndent < textIndent) && ch === 32) {
      state.lineIndent++;
      ch = state.input.charCodeAt(++state.position);
    }
    if (!detectedIndent && state.lineIndent > textIndent) {
      textIndent = state.lineIndent;
    }
    if (is_EOL(ch)) {
      emptyLines++;
      continue;
    }
    if (state.lineIndent < textIndent) {
      if (chomping === CHOMPING_KEEP) {
        state.result += common.repeat(`
`, didReadContent ? 1 + emptyLines : emptyLines);
      } else if (chomping === CHOMPING_CLIP) {
        if (didReadContent) {
          state.result += `
`;
        }
      }
      break;
    }
    if (folding) {
      if (is_WHITE_SPACE(ch)) {
        atMoreIndented = true;
        state.result += common.repeat(`
`, didReadContent ? 1 + emptyLines : emptyLines);
      } else if (atMoreIndented) {
        atMoreIndented = false;
        state.result += common.repeat(`
`, emptyLines + 1);
      } else if (emptyLines === 0) {
        if (didReadContent) {
          state.result += " ";
        }
      } else {
        state.result += common.repeat(`
`, emptyLines);
      }
    } else {
      state.result += common.repeat(`
`, didReadContent ? 1 + emptyLines : emptyLines);
    }
    didReadContent = true;
    detectedIndent = true;
    emptyLines = 0;
    captureStart = state.position;
    while (!is_EOL(ch) && ch !== 0) {
      ch = state.input.charCodeAt(++state.position);
    }
    captureSegment(state, captureStart, state.position, false);
  }
  return true;
}
function readBlockSequence(state, nodeIndent) {
  var _line, _tag = state.tag, _anchor = state.anchor, _result = [], following, detected = false, ch;
  if (state.firstTabInLine !== -1)
    return false;
  if (state.anchor !== null) {
    state.anchorMap[state.anchor] = _result;
  }
  ch = state.input.charCodeAt(state.position);
  while (ch !== 0) {
    if (state.firstTabInLine !== -1) {
      state.position = state.firstTabInLine;
      throwError(state, "tab characters must not be used in indentation");
    }
    if (ch !== 45) {
      break;
    }
    following = state.input.charCodeAt(state.position + 1);
    if (!is_WS_OR_EOL(following)) {
      break;
    }
    detected = true;
    state.position++;
    if (skipSeparationSpace(state, true, -1)) {
      if (state.lineIndent <= nodeIndent) {
        _result.push(null);
        ch = state.input.charCodeAt(state.position);
        continue;
      }
    }
    _line = state.line;
    composeNode(state, nodeIndent, CONTEXT_BLOCK_IN, false, true);
    _result.push(state.result);
    skipSeparationSpace(state, true, -1);
    ch = state.input.charCodeAt(state.position);
    if ((state.line === _line || state.lineIndent > nodeIndent) && ch !== 0) {
      throwError(state, "bad indentation of a sequence entry");
    } else if (state.lineIndent < nodeIndent) {
      break;
    }
  }
  if (detected) {
    state.tag = _tag;
    state.anchor = _anchor;
    state.kind = "sequence";
    state.result = _result;
    return true;
  }
  return false;
}
function readBlockMapping(state, nodeIndent, flowIndent) {
  var following, allowCompact, _line, _keyLine, _keyLineStart, _keyPos, _tag = state.tag, _anchor = state.anchor, _result = {}, overridableKeys = Object.create(null), keyTag = null, keyNode = null, valueNode = null, atExplicitKey = false, detected = false, ch;
  if (state.firstTabInLine !== -1)
    return false;
  if (state.anchor !== null) {
    state.anchorMap[state.anchor] = _result;
  }
  ch = state.input.charCodeAt(state.position);
  while (ch !== 0) {
    if (!atExplicitKey && state.firstTabInLine !== -1) {
      state.position = state.firstTabInLine;
      throwError(state, "tab characters must not be used in indentation");
    }
    following = state.input.charCodeAt(state.position + 1);
    _line = state.line;
    if ((ch === 63 || ch === 58) && is_WS_OR_EOL(following)) {
      if (ch === 63) {
        if (atExplicitKey) {
          storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
          keyTag = keyNode = valueNode = null;
        }
        detected = true;
        atExplicitKey = true;
        allowCompact = true;
      } else if (atExplicitKey) {
        atExplicitKey = false;
        allowCompact = true;
      } else {
        throwError(state, "incomplete explicit mapping pair; a key node is missed; or followed by a non-tabulated empty line");
      }
      state.position += 1;
      ch = following;
    } else {
      _keyLine = state.line;
      _keyLineStart = state.lineStart;
      _keyPos = state.position;
      if (!composeNode(state, flowIndent, CONTEXT_FLOW_OUT, false, true)) {
        break;
      }
      if (state.line === _line) {
        ch = state.input.charCodeAt(state.position);
        while (is_WHITE_SPACE(ch)) {
          ch = state.input.charCodeAt(++state.position);
        }
        if (ch === 58) {
          ch = state.input.charCodeAt(++state.position);
          if (!is_WS_OR_EOL(ch)) {
            throwError(state, "a whitespace character is expected after the key-value separator within a block mapping");
          }
          if (atExplicitKey) {
            storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
            keyTag = keyNode = valueNode = null;
          }
          detected = true;
          atExplicitKey = false;
          allowCompact = false;
          keyTag = state.tag;
          keyNode = state.result;
        } else if (detected) {
          throwError(state, "can not read an implicit mapping pair; a colon is missed");
        } else {
          state.tag = _tag;
          state.anchor = _anchor;
          return true;
        }
      } else if (detected) {
        throwError(state, "can not read a block mapping entry; a multiline key may not be an implicit key");
      } else {
        state.tag = _tag;
        state.anchor = _anchor;
        return true;
      }
    }
    if (state.line === _line || state.lineIndent > nodeIndent) {
      if (atExplicitKey) {
        _keyLine = state.line;
        _keyLineStart = state.lineStart;
        _keyPos = state.position;
      }
      if (composeNode(state, nodeIndent, CONTEXT_BLOCK_OUT, true, allowCompact)) {
        if (atExplicitKey) {
          keyNode = state.result;
        } else {
          valueNode = state.result;
        }
      }
      if (!atExplicitKey) {
        storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, _keyLine, _keyLineStart, _keyPos);
        keyTag = keyNode = valueNode = null;
      }
      skipSeparationSpace(state, true, -1);
      ch = state.input.charCodeAt(state.position);
    }
    if ((state.line === _line || state.lineIndent > nodeIndent) && ch !== 0) {
      throwError(state, "bad indentation of a mapping entry");
    } else if (state.lineIndent < nodeIndent) {
      break;
    }
  }
  if (atExplicitKey) {
    storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
  }
  if (detected) {
    state.tag = _tag;
    state.anchor = _anchor;
    state.kind = "mapping";
    state.result = _result;
  }
  return detected;
}
function readTagProperty(state) {
  var _position, isVerbatim = false, isNamed = false, tagHandle, tagName, ch;
  ch = state.input.charCodeAt(state.position);
  if (ch !== 33)
    return false;
  if (state.tag !== null) {
    throwError(state, "duplication of a tag property");
  }
  ch = state.input.charCodeAt(++state.position);
  if (ch === 60) {
    isVerbatim = true;
    ch = state.input.charCodeAt(++state.position);
  } else if (ch === 33) {
    isNamed = true;
    tagHandle = "!!";
    ch = state.input.charCodeAt(++state.position);
  } else {
    tagHandle = "!";
  }
  _position = state.position;
  if (isVerbatim) {
    do {
      ch = state.input.charCodeAt(++state.position);
    } while (ch !== 0 && ch !== 62);
    if (state.position < state.length) {
      tagName = state.input.slice(_position, state.position);
      ch = state.input.charCodeAt(++state.position);
    } else {
      throwError(state, "unexpected end of the stream within a verbatim tag");
    }
  } else {
    while (ch !== 0 && !is_WS_OR_EOL(ch)) {
      if (ch === 33) {
        if (!isNamed) {
          tagHandle = state.input.slice(_position - 1, state.position + 1);
          if (!PATTERN_TAG_HANDLE.test(tagHandle)) {
            throwError(state, "named tag handle cannot contain such characters");
          }
          isNamed = true;
          _position = state.position + 1;
        } else {
          throwError(state, "tag suffix cannot contain exclamation marks");
        }
      }
      ch = state.input.charCodeAt(++state.position);
    }
    tagName = state.input.slice(_position, state.position);
    if (PATTERN_FLOW_INDICATORS.test(tagName)) {
      throwError(state, "tag suffix cannot contain flow indicator characters");
    }
  }
  if (tagName && !PATTERN_TAG_URI.test(tagName)) {
    throwError(state, "tag name cannot contain such characters: " + tagName);
  }
  try {
    tagName = decodeURIComponent(tagName);
  } catch (err) {
    throwError(state, "tag name is malformed: " + tagName);
  }
  if (isVerbatim) {
    state.tag = tagName;
  } else if (_hasOwnProperty$1.call(state.tagMap, tagHandle)) {
    state.tag = state.tagMap[tagHandle] + tagName;
  } else if (tagHandle === "!") {
    state.tag = "!" + tagName;
  } else if (tagHandle === "!!") {
    state.tag = "tag:yaml.org,2002:" + tagName;
  } else {
    throwError(state, 'undeclared tag handle "' + tagHandle + '"');
  }
  return true;
}
function readAnchorProperty(state) {
  var _position, ch;
  ch = state.input.charCodeAt(state.position);
  if (ch !== 38)
    return false;
  if (state.anchor !== null) {
    throwError(state, "duplication of an anchor property");
  }
  ch = state.input.charCodeAt(++state.position);
  _position = state.position;
  while (ch !== 0 && !is_WS_OR_EOL(ch) && !is_FLOW_INDICATOR(ch)) {
    ch = state.input.charCodeAt(++state.position);
  }
  if (state.position === _position) {
    throwError(state, "name of an anchor node must contain at least one character");
  }
  state.anchor = state.input.slice(_position, state.position);
  return true;
}
function readAlias(state) {
  var _position, alias, ch;
  ch = state.input.charCodeAt(state.position);
  if (ch !== 42)
    return false;
  ch = state.input.charCodeAt(++state.position);
  _position = state.position;
  while (ch !== 0 && !is_WS_OR_EOL(ch) && !is_FLOW_INDICATOR(ch)) {
    ch = state.input.charCodeAt(++state.position);
  }
  if (state.position === _position) {
    throwError(state, "name of an alias node must contain at least one character");
  }
  alias = state.input.slice(_position, state.position);
  if (!_hasOwnProperty$1.call(state.anchorMap, alias)) {
    throwError(state, 'unidentified alias "' + alias + '"');
  }
  state.result = state.anchorMap[alias];
  skipSeparationSpace(state, true, -1);
  return true;
}
function composeNode(state, parentIndent, nodeContext, allowToSeek, allowCompact) {
  var allowBlockStyles, allowBlockScalars, allowBlockCollections, indentStatus = 1, atNewLine = false, hasContent = false, typeIndex, typeQuantity, typeList, type2, flowIndent, blockIndent;
  if (state.listener !== null) {
    state.listener("open", state);
  }
  state.tag = null;
  state.anchor = null;
  state.kind = null;
  state.result = null;
  allowBlockStyles = allowBlockScalars = allowBlockCollections = CONTEXT_BLOCK_OUT === nodeContext || CONTEXT_BLOCK_IN === nodeContext;
  if (allowToSeek) {
    if (skipSeparationSpace(state, true, -1)) {
      atNewLine = true;
      if (state.lineIndent > parentIndent) {
        indentStatus = 1;
      } else if (state.lineIndent === parentIndent) {
        indentStatus = 0;
      } else if (state.lineIndent < parentIndent) {
        indentStatus = -1;
      }
    }
  }
  if (indentStatus === 1) {
    while (readTagProperty(state) || readAnchorProperty(state)) {
      if (skipSeparationSpace(state, true, -1)) {
        atNewLine = true;
        allowBlockCollections = allowBlockStyles;
        if (state.lineIndent > parentIndent) {
          indentStatus = 1;
        } else if (state.lineIndent === parentIndent) {
          indentStatus = 0;
        } else if (state.lineIndent < parentIndent) {
          indentStatus = -1;
        }
      } else {
        allowBlockCollections = false;
      }
    }
  }
  if (allowBlockCollections) {
    allowBlockCollections = atNewLine || allowCompact;
  }
  if (indentStatus === 1 || CONTEXT_BLOCK_OUT === nodeContext) {
    if (CONTEXT_FLOW_IN === nodeContext || CONTEXT_FLOW_OUT === nodeContext) {
      flowIndent = parentIndent;
    } else {
      flowIndent = parentIndent + 1;
    }
    blockIndent = state.position - state.lineStart;
    if (indentStatus === 1) {
      if (allowBlockCollections && (readBlockSequence(state, blockIndent) || readBlockMapping(state, blockIndent, flowIndent)) || readFlowCollection(state, flowIndent)) {
        hasContent = true;
      } else {
        if (allowBlockScalars && readBlockScalar(state, flowIndent) || readSingleQuotedScalar(state, flowIndent) || readDoubleQuotedScalar(state, flowIndent)) {
          hasContent = true;
        } else if (readAlias(state)) {
          hasContent = true;
          if (state.tag !== null || state.anchor !== null) {
            throwError(state, "alias node should not have any properties");
          }
        } else if (readPlainScalar(state, flowIndent, CONTEXT_FLOW_IN === nodeContext)) {
          hasContent = true;
          if (state.tag === null) {
            state.tag = "?";
          }
        }
        if (state.anchor !== null) {
          state.anchorMap[state.anchor] = state.result;
        }
      }
    } else if (indentStatus === 0) {
      hasContent = allowBlockCollections && readBlockSequence(state, blockIndent);
    }
  }
  if (state.tag === null) {
    if (state.anchor !== null) {
      state.anchorMap[state.anchor] = state.result;
    }
  } else if (state.tag === "?") {
    if (state.result !== null && state.kind !== "scalar") {
      throwError(state, 'unacceptable node kind for !<?> tag; it should be "scalar", not "' + state.kind + '"');
    }
    for (typeIndex = 0, typeQuantity = state.implicitTypes.length;typeIndex < typeQuantity; typeIndex += 1) {
      type2 = state.implicitTypes[typeIndex];
      if (type2.resolve(state.result)) {
        state.result = type2.construct(state.result);
        state.tag = type2.tag;
        if (state.anchor !== null) {
          state.anchorMap[state.anchor] = state.result;
        }
        break;
      }
    }
  } else if (state.tag !== "!") {
    if (_hasOwnProperty$1.call(state.typeMap[state.kind || "fallback"], state.tag)) {
      type2 = state.typeMap[state.kind || "fallback"][state.tag];
    } else {
      type2 = null;
      typeList = state.typeMap.multi[state.kind || "fallback"];
      for (typeIndex = 0, typeQuantity = typeList.length;typeIndex < typeQuantity; typeIndex += 1) {
        if (state.tag.slice(0, typeList[typeIndex].tag.length) === typeList[typeIndex].tag) {
          type2 = typeList[typeIndex];
          break;
        }
      }
    }
    if (!type2) {
      throwError(state, "unknown tag !<" + state.tag + ">");
    }
    if (state.result !== null && type2.kind !== state.kind) {
      throwError(state, "unacceptable node kind for !<" + state.tag + '> tag; it should be "' + type2.kind + '", not "' + state.kind + '"');
    }
    if (!type2.resolve(state.result, state.tag)) {
      throwError(state, "cannot resolve a node with !<" + state.tag + "> explicit tag");
    } else {
      state.result = type2.construct(state.result, state.tag);
      if (state.anchor !== null) {
        state.anchorMap[state.anchor] = state.result;
      }
    }
  }
  if (state.listener !== null) {
    state.listener("close", state);
  }
  return state.tag !== null || state.anchor !== null || hasContent;
}
function readDocument(state) {
  var documentStart = state.position, _position, directiveName, directiveArgs, hasDirectives = false, ch;
  state.version = null;
  state.checkLineBreaks = state.legacy;
  state.tagMap = Object.create(null);
  state.anchorMap = Object.create(null);
  while ((ch = state.input.charCodeAt(state.position)) !== 0) {
    skipSeparationSpace(state, true, -1);
    ch = state.input.charCodeAt(state.position);
    if (state.lineIndent > 0 || ch !== 37) {
      break;
    }
    hasDirectives = true;
    ch = state.input.charCodeAt(++state.position);
    _position = state.position;
    while (ch !== 0 && !is_WS_OR_EOL(ch)) {
      ch = state.input.charCodeAt(++state.position);
    }
    directiveName = state.input.slice(_position, state.position);
    directiveArgs = [];
    if (directiveName.length < 1) {
      throwError(state, "directive name must not be less than one character in length");
    }
    while (ch !== 0) {
      while (is_WHITE_SPACE(ch)) {
        ch = state.input.charCodeAt(++state.position);
      }
      if (ch === 35) {
        do {
          ch = state.input.charCodeAt(++state.position);
        } while (ch !== 0 && !is_EOL(ch));
        break;
      }
      if (is_EOL(ch))
        break;
      _position = state.position;
      while (ch !== 0 && !is_WS_OR_EOL(ch)) {
        ch = state.input.charCodeAt(++state.position);
      }
      directiveArgs.push(state.input.slice(_position, state.position));
    }
    if (ch !== 0)
      readLineBreak(state);
    if (_hasOwnProperty$1.call(directiveHandlers, directiveName)) {
      directiveHandlers[directiveName](state, directiveName, directiveArgs);
    } else {
      throwWarning(state, 'unknown document directive "' + directiveName + '"');
    }
  }
  skipSeparationSpace(state, true, -1);
  if (state.lineIndent === 0 && state.input.charCodeAt(state.position) === 45 && state.input.charCodeAt(state.position + 1) === 45 && state.input.charCodeAt(state.position + 2) === 45) {
    state.position += 3;
    skipSeparationSpace(state, true, -1);
  } else if (hasDirectives) {
    throwError(state, "directives end mark is expected");
  }
  composeNode(state, state.lineIndent - 1, CONTEXT_BLOCK_OUT, false, true);
  skipSeparationSpace(state, true, -1);
  if (state.checkLineBreaks && PATTERN_NON_ASCII_LINE_BREAKS.test(state.input.slice(documentStart, state.position))) {
    throwWarning(state, "non-ASCII line breaks are interpreted as content");
  }
  state.documents.push(state.result);
  if (state.position === state.lineStart && testDocumentSeparator(state)) {
    if (state.input.charCodeAt(state.position) === 46) {
      state.position += 3;
      skipSeparationSpace(state, true, -1);
    }
    return;
  }
  if (state.position < state.length - 1) {
    throwError(state, "end of the stream or a document separator is expected");
  } else {
    return;
  }
}
function loadDocuments(input, options) {
  input = String(input);
  options = options || {};
  if (input.length !== 0) {
    if (input.charCodeAt(input.length - 1) !== 10 && input.charCodeAt(input.length - 1) !== 13) {
      input += `
`;
    }
    if (input.charCodeAt(0) === 65279) {
      input = input.slice(1);
    }
  }
  var state = new State$1(input, options);
  var nullpos = input.indexOf("\x00");
  if (nullpos !== -1) {
    state.position = nullpos;
    throwError(state, "null byte is not allowed in input");
  }
  state.input += "\x00";
  while (state.input.charCodeAt(state.position) === 32) {
    state.lineIndent += 1;
    state.position += 1;
  }
  while (state.position < state.length - 1) {
    readDocument(state);
  }
  return state.documents;
}
function loadAll$1(input, iterator, options) {
  if (iterator !== null && typeof iterator === "object" && typeof options === "undefined") {
    options = iterator;
    iterator = null;
  }
  var documents = loadDocuments(input, options);
  if (typeof iterator !== "function") {
    return documents;
  }
  for (var index = 0, length = documents.length;index < length; index += 1) {
    iterator(documents[index]);
  }
}
function load$1(input, options) {
  var documents = loadDocuments(input, options);
  if (documents.length === 0) {
    return;
  } else if (documents.length === 1) {
    return documents[0];
  }
  throw new exception("expected a single document in the stream, but found more");
}
function compileStyleMap(schema2, map2) {
  var result, keys, index, length, tag, style, type2;
  if (map2 === null)
    return {};
  result = {};
  keys = Object.keys(map2);
  for (index = 0, length = keys.length;index < length; index += 1) {
    tag = keys[index];
    style = String(map2[tag]);
    if (tag.slice(0, 2) === "!!") {
      tag = "tag:yaml.org,2002:" + tag.slice(2);
    }
    type2 = schema2.compiledTypeMap["fallback"][tag];
    if (type2 && _hasOwnProperty.call(type2.styleAliases, style)) {
      style = type2.styleAliases[style];
    }
    result[tag] = style;
  }
  return result;
}
function encodeHex(character) {
  var string, handle, length;
  string = character.toString(16).toUpperCase();
  if (character <= 255) {
    handle = "x";
    length = 2;
  } else if (character <= 65535) {
    handle = "u";
    length = 4;
  } else if (character <= 4294967295) {
    handle = "U";
    length = 8;
  } else {
    throw new exception("code point within a string may not be greater than 0xFFFFFFFF");
  }
  return "\\" + handle + common.repeat("0", length - string.length) + string;
}
function State(options) {
  this.schema = options["schema"] || _default;
  this.indent = Math.max(1, options["indent"] || 2);
  this.noArrayIndent = options["noArrayIndent"] || false;
  this.skipInvalid = options["skipInvalid"] || false;
  this.flowLevel = common.isNothing(options["flowLevel"]) ? -1 : options["flowLevel"];
  this.styleMap = compileStyleMap(this.schema, options["styles"] || null);
  this.sortKeys = options["sortKeys"] || false;
  this.lineWidth = options["lineWidth"] || 80;
  this.noRefs = options["noRefs"] || false;
  this.noCompatMode = options["noCompatMode"] || false;
  this.condenseFlow = options["condenseFlow"] || false;
  this.quotingType = options["quotingType"] === '"' ? QUOTING_TYPE_DOUBLE : QUOTING_TYPE_SINGLE;
  this.forceQuotes = options["forceQuotes"] || false;
  this.replacer = typeof options["replacer"] === "function" ? options["replacer"] : null;
  this.implicitTypes = this.schema.compiledImplicit;
  this.explicitTypes = this.schema.compiledExplicit;
  this.tag = null;
  this.result = "";
  this.duplicates = [];
  this.usedDuplicates = null;
}
function indentString(string, spaces) {
  var ind = common.repeat(" ", spaces), position = 0, next = -1, result = "", line, length = string.length;
  while (position < length) {
    next = string.indexOf(`
`, position);
    if (next === -1) {
      line = string.slice(position);
      position = length;
    } else {
      line = string.slice(position, next + 1);
      position = next + 1;
    }
    if (line.length && line !== `
`)
      result += ind;
    result += line;
  }
  return result;
}
function generateNextLine(state, level) {
  return `
` + common.repeat(" ", state.indent * level);
}
function testImplicitResolving(state, str2) {
  var index, length, type2;
  for (index = 0, length = state.implicitTypes.length;index < length; index += 1) {
    type2 = state.implicitTypes[index];
    if (type2.resolve(str2)) {
      return true;
    }
  }
  return false;
}
function isWhitespace(c) {
  return c === CHAR_SPACE || c === CHAR_TAB;
}
function isPrintable(c) {
  return 32 <= c && c <= 126 || 161 <= c && c <= 55295 && c !== 8232 && c !== 8233 || 57344 <= c && c <= 65533 && c !== CHAR_BOM || 65536 <= c && c <= 1114111;
}
function isNsCharOrWhitespace(c) {
  return isPrintable(c) && c !== CHAR_BOM && c !== CHAR_CARRIAGE_RETURN && c !== CHAR_LINE_FEED;
}
function isPlainSafe(c, prev, inblock) {
  var cIsNsCharOrWhitespace = isNsCharOrWhitespace(c);
  var cIsNsChar = cIsNsCharOrWhitespace && !isWhitespace(c);
  return (inblock ? cIsNsCharOrWhitespace : cIsNsCharOrWhitespace && c !== CHAR_COMMA && c !== CHAR_LEFT_SQUARE_BRACKET && c !== CHAR_RIGHT_SQUARE_BRACKET && c !== CHAR_LEFT_CURLY_BRACKET && c !== CHAR_RIGHT_CURLY_BRACKET) && c !== CHAR_SHARP && !(prev === CHAR_COLON && !cIsNsChar) || isNsCharOrWhitespace(prev) && !isWhitespace(prev) && c === CHAR_SHARP || prev === CHAR_COLON && cIsNsChar;
}
function isPlainSafeFirst(c) {
  return isPrintable(c) && c !== CHAR_BOM && !isWhitespace(c) && c !== CHAR_MINUS && c !== CHAR_QUESTION && c !== CHAR_COLON && c !== CHAR_COMMA && c !== CHAR_LEFT_SQUARE_BRACKET && c !== CHAR_RIGHT_SQUARE_BRACKET && c !== CHAR_LEFT_CURLY_BRACKET && c !== CHAR_RIGHT_CURLY_BRACKET && c !== CHAR_SHARP && c !== CHAR_AMPERSAND && c !== CHAR_ASTERISK && c !== CHAR_EXCLAMATION && c !== CHAR_VERTICAL_LINE && c !== CHAR_EQUALS && c !== CHAR_GREATER_THAN && c !== CHAR_SINGLE_QUOTE && c !== CHAR_DOUBLE_QUOTE && c !== CHAR_PERCENT && c !== CHAR_COMMERCIAL_AT && c !== CHAR_GRAVE_ACCENT;
}
function isPlainSafeLast(c) {
  return !isWhitespace(c) && c !== CHAR_COLON;
}
function codePointAt(string, pos) {
  var first = string.charCodeAt(pos), second;
  if (first >= 55296 && first <= 56319 && pos + 1 < string.length) {
    second = string.charCodeAt(pos + 1);
    if (second >= 56320 && second <= 57343) {
      return (first - 55296) * 1024 + second - 56320 + 65536;
    }
  }
  return first;
}
function needIndentIndicator(string) {
  var leadingSpaceRe = /^\n* /;
  return leadingSpaceRe.test(string);
}
function chooseScalarStyle(string, singleLineOnly, indentPerLevel, lineWidth, testAmbiguousType, quotingType, forceQuotes, inblock) {
  var i2;
  var char = 0;
  var prevChar = null;
  var hasLineBreak = false;
  var hasFoldableLine = false;
  var shouldTrackWidth = lineWidth !== -1;
  var previousLineBreak = -1;
  var plain = isPlainSafeFirst(codePointAt(string, 0)) && isPlainSafeLast(codePointAt(string, string.length - 1));
  if (singleLineOnly || forceQuotes) {
    for (i2 = 0;i2 < string.length; char >= 65536 ? i2 += 2 : i2++) {
      char = codePointAt(string, i2);
      if (!isPrintable(char)) {
        return STYLE_DOUBLE;
      }
      plain = plain && isPlainSafe(char, prevChar, inblock);
      prevChar = char;
    }
  } else {
    for (i2 = 0;i2 < string.length; char >= 65536 ? i2 += 2 : i2++) {
      char = codePointAt(string, i2);
      if (char === CHAR_LINE_FEED) {
        hasLineBreak = true;
        if (shouldTrackWidth) {
          hasFoldableLine = hasFoldableLine || i2 - previousLineBreak - 1 > lineWidth && string[previousLineBreak + 1] !== " ";
          previousLineBreak = i2;
        }
      } else if (!isPrintable(char)) {
        return STYLE_DOUBLE;
      }
      plain = plain && isPlainSafe(char, prevChar, inblock);
      prevChar = char;
    }
    hasFoldableLine = hasFoldableLine || shouldTrackWidth && (i2 - previousLineBreak - 1 > lineWidth && string[previousLineBreak + 1] !== " ");
  }
  if (!hasLineBreak && !hasFoldableLine) {
    if (plain && !forceQuotes && !testAmbiguousType(string)) {
      return STYLE_PLAIN;
    }
    return quotingType === QUOTING_TYPE_DOUBLE ? STYLE_DOUBLE : STYLE_SINGLE;
  }
  if (indentPerLevel > 9 && needIndentIndicator(string)) {
    return STYLE_DOUBLE;
  }
  if (!forceQuotes) {
    return hasFoldableLine ? STYLE_FOLDED : STYLE_LITERAL;
  }
  return quotingType === QUOTING_TYPE_DOUBLE ? STYLE_DOUBLE : STYLE_SINGLE;
}
function writeScalar(state, string, level, iskey, inblock) {
  state.dump = function() {
    if (string.length === 0) {
      return state.quotingType === QUOTING_TYPE_DOUBLE ? '""' : "''";
    }
    if (!state.noCompatMode) {
      if (DEPRECATED_BOOLEANS_SYNTAX.indexOf(string) !== -1 || DEPRECATED_BASE60_SYNTAX.test(string)) {
        return state.quotingType === QUOTING_TYPE_DOUBLE ? '"' + string + '"' : "'" + string + "'";
      }
    }
    var indent = state.indent * Math.max(1, level);
    var lineWidth = state.lineWidth === -1 ? -1 : Math.max(Math.min(state.lineWidth, 40), state.lineWidth - indent);
    var singleLineOnly = iskey || state.flowLevel > -1 && level >= state.flowLevel;
    function testAmbiguity(string2) {
      return testImplicitResolving(state, string2);
    }
    switch (chooseScalarStyle(string, singleLineOnly, state.indent, lineWidth, testAmbiguity, state.quotingType, state.forceQuotes && !iskey, inblock)) {
      case STYLE_PLAIN:
        return string;
      case STYLE_SINGLE:
        return "'" + string.replace(/'/g, "''") + "'";
      case STYLE_LITERAL:
        return "|" + blockHeader(string, state.indent) + dropEndingNewline(indentString(string, indent));
      case STYLE_FOLDED:
        return ">" + blockHeader(string, state.indent) + dropEndingNewline(indentString(foldString(string, lineWidth), indent));
      case STYLE_DOUBLE:
        return '"' + escapeString(string) + '"';
      default:
        throw new exception("impossible error: invalid scalar style");
    }
  }();
}
function blockHeader(string, indentPerLevel) {
  var indentIndicator = needIndentIndicator(string) ? String(indentPerLevel) : "";
  var clip = string[string.length - 1] === `
`;
  var keep = clip && (string[string.length - 2] === `
` || string === `
`);
  var chomp = keep ? "+" : clip ? "" : "-";
  return indentIndicator + chomp + `
`;
}
function dropEndingNewline(string) {
  return string[string.length - 1] === `
` ? string.slice(0, -1) : string;
}
function foldString(string, width) {
  var lineRe = /(\n+)([^\n]*)/g;
  var result = function() {
    var nextLF = string.indexOf(`
`);
    nextLF = nextLF !== -1 ? nextLF : string.length;
    lineRe.lastIndex = nextLF;
    return foldLine(string.slice(0, nextLF), width);
  }();
  var prevMoreIndented = string[0] === `
` || string[0] === " ";
  var moreIndented;
  var match;
  while (match = lineRe.exec(string)) {
    var prefix = match[1], line = match[2];
    moreIndented = line[0] === " ";
    result += prefix + (!prevMoreIndented && !moreIndented && line !== "" ? `
` : "") + foldLine(line, width);
    prevMoreIndented = moreIndented;
  }
  return result;
}
function foldLine(line, width) {
  if (line === "" || line[0] === " ")
    return line;
  var breakRe = / [^ ]/g;
  var match;
  var start = 0, end, curr = 0, next = 0;
  var result = "";
  while (match = breakRe.exec(line)) {
    next = match.index;
    if (next - start > width) {
      end = curr > start ? curr : next;
      result += `
` + line.slice(start, end);
      start = end + 1;
    }
    curr = next;
  }
  result += `
`;
  if (line.length - start > width && curr > start) {
    result += line.slice(start, curr) + `
` + line.slice(curr + 1);
  } else {
    result += line.slice(start);
  }
  return result.slice(1);
}
function escapeString(string) {
  var result = "";
  var char = 0;
  var escapeSeq;
  for (var i2 = 0;i2 < string.length; char >= 65536 ? i2 += 2 : i2++) {
    char = codePointAt(string, i2);
    escapeSeq = ESCAPE_SEQUENCES[char];
    if (!escapeSeq && isPrintable(char)) {
      result += string[i2];
      if (char >= 65536)
        result += string[i2 + 1];
    } else {
      result += escapeSeq || encodeHex(char);
    }
  }
  return result;
}
function writeFlowSequence(state, level, object) {
  var _result = "", _tag = state.tag, index, length, value;
  for (index = 0, length = object.length;index < length; index += 1) {
    value = object[index];
    if (state.replacer) {
      value = state.replacer.call(object, String(index), value);
    }
    if (writeNode(state, level, value, false, false) || typeof value === "undefined" && writeNode(state, level, null, false, false)) {
      if (_result !== "")
        _result += "," + (!state.condenseFlow ? " " : "");
      _result += state.dump;
    }
  }
  state.tag = _tag;
  state.dump = "[" + _result + "]";
}
function writeBlockSequence(state, level, object, compact) {
  var _result = "", _tag = state.tag, index, length, value;
  for (index = 0, length = object.length;index < length; index += 1) {
    value = object[index];
    if (state.replacer) {
      value = state.replacer.call(object, String(index), value);
    }
    if (writeNode(state, level + 1, value, true, true, false, true) || typeof value === "undefined" && writeNode(state, level + 1, null, true, true, false, true)) {
      if (!compact || _result !== "") {
        _result += generateNextLine(state, level);
      }
      if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) {
        _result += "-";
      } else {
        _result += "- ";
      }
      _result += state.dump;
    }
  }
  state.tag = _tag;
  state.dump = _result || "[]";
}
function writeFlowMapping(state, level, object) {
  var _result = "", _tag = state.tag, objectKeyList = Object.keys(object), index, length, objectKey, objectValue, pairBuffer;
  for (index = 0, length = objectKeyList.length;index < length; index += 1) {
    pairBuffer = "";
    if (_result !== "")
      pairBuffer += ", ";
    if (state.condenseFlow)
      pairBuffer += '"';
    objectKey = objectKeyList[index];
    objectValue = object[objectKey];
    if (state.replacer) {
      objectValue = state.replacer.call(object, objectKey, objectValue);
    }
    if (!writeNode(state, level, objectKey, false, false)) {
      continue;
    }
    if (state.dump.length > 1024)
      pairBuffer += "? ";
    pairBuffer += state.dump + (state.condenseFlow ? '"' : "") + ":" + (state.condenseFlow ? "" : " ");
    if (!writeNode(state, level, objectValue, false, false)) {
      continue;
    }
    pairBuffer += state.dump;
    _result += pairBuffer;
  }
  state.tag = _tag;
  state.dump = "{" + _result + "}";
}
function writeBlockMapping(state, level, object, compact) {
  var _result = "", _tag = state.tag, objectKeyList = Object.keys(object), index, length, objectKey, objectValue, explicitPair, pairBuffer;
  if (state.sortKeys === true) {
    objectKeyList.sort();
  } else if (typeof state.sortKeys === "function") {
    objectKeyList.sort(state.sortKeys);
  } else if (state.sortKeys) {
    throw new exception("sortKeys must be a boolean or a function");
  }
  for (index = 0, length = objectKeyList.length;index < length; index += 1) {
    pairBuffer = "";
    if (!compact || _result !== "") {
      pairBuffer += generateNextLine(state, level);
    }
    objectKey = objectKeyList[index];
    objectValue = object[objectKey];
    if (state.replacer) {
      objectValue = state.replacer.call(object, objectKey, objectValue);
    }
    if (!writeNode(state, level + 1, objectKey, true, true, true)) {
      continue;
    }
    explicitPair = state.tag !== null && state.tag !== "?" || state.dump && state.dump.length > 1024;
    if (explicitPair) {
      if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) {
        pairBuffer += "?";
      } else {
        pairBuffer += "? ";
      }
    }
    pairBuffer += state.dump;
    if (explicitPair) {
      pairBuffer += generateNextLine(state, level);
    }
    if (!writeNode(state, level + 1, objectValue, true, explicitPair)) {
      continue;
    }
    if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) {
      pairBuffer += ":";
    } else {
      pairBuffer += ": ";
    }
    pairBuffer += state.dump;
    _result += pairBuffer;
  }
  state.tag = _tag;
  state.dump = _result || "{}";
}
function detectType(state, object, explicit) {
  var _result, typeList, index, length, type2, style;
  typeList = explicit ? state.explicitTypes : state.implicitTypes;
  for (index = 0, length = typeList.length;index < length; index += 1) {
    type2 = typeList[index];
    if ((type2.instanceOf || type2.predicate) && (!type2.instanceOf || typeof object === "object" && object instanceof type2.instanceOf) && (!type2.predicate || type2.predicate(object))) {
      if (explicit) {
        if (type2.multi && type2.representName) {
          state.tag = type2.representName(object);
        } else {
          state.tag = type2.tag;
        }
      } else {
        state.tag = "?";
      }
      if (type2.represent) {
        style = state.styleMap[type2.tag] || type2.defaultStyle;
        if (_toString.call(type2.represent) === "[object Function]") {
          _result = type2.represent(object, style);
        } else if (_hasOwnProperty.call(type2.represent, style)) {
          _result = type2.represent[style](object, style);
        } else {
          throw new exception("!<" + type2.tag + '> tag resolver accepts not "' + style + '" style');
        }
        state.dump = _result;
      }
      return true;
    }
  }
  return false;
}
function writeNode(state, level, object, block, compact, iskey, isblockseq) {
  state.tag = null;
  state.dump = object;
  if (!detectType(state, object, false)) {
    detectType(state, object, true);
  }
  var type2 = _toString.call(state.dump);
  var inblock = block;
  var tagStr;
  if (block) {
    block = state.flowLevel < 0 || state.flowLevel > level;
  }
  var objectOrArray = type2 === "[object Object]" || type2 === "[object Array]", duplicateIndex, duplicate;
  if (objectOrArray) {
    duplicateIndex = state.duplicates.indexOf(object);
    duplicate = duplicateIndex !== -1;
  }
  if (state.tag !== null && state.tag !== "?" || duplicate || state.indent !== 2 && level > 0) {
    compact = false;
  }
  if (duplicate && state.usedDuplicates[duplicateIndex]) {
    state.dump = "*ref_" + duplicateIndex;
  } else {
    if (objectOrArray && duplicate && !state.usedDuplicates[duplicateIndex]) {
      state.usedDuplicates[duplicateIndex] = true;
    }
    if (type2 === "[object Object]") {
      if (block && Object.keys(state.dump).length !== 0) {
        writeBlockMapping(state, level, state.dump, compact);
        if (duplicate) {
          state.dump = "&ref_" + duplicateIndex + state.dump;
        }
      } else {
        writeFlowMapping(state, level, state.dump);
        if (duplicate) {
          state.dump = "&ref_" + duplicateIndex + " " + state.dump;
        }
      }
    } else if (type2 === "[object Array]") {
      if (block && state.dump.length !== 0) {
        if (state.noArrayIndent && !isblockseq && level > 0) {
          writeBlockSequence(state, level - 1, state.dump, compact);
        } else {
          writeBlockSequence(state, level, state.dump, compact);
        }
        if (duplicate) {
          state.dump = "&ref_" + duplicateIndex + state.dump;
        }
      } else {
        writeFlowSequence(state, level, state.dump);
        if (duplicate) {
          state.dump = "&ref_" + duplicateIndex + " " + state.dump;
        }
      }
    } else if (type2 === "[object String]") {
      if (state.tag !== "?") {
        writeScalar(state, state.dump, level, iskey, inblock);
      }
    } else if (type2 === "[object Undefined]") {
      return false;
    } else {
      if (state.skipInvalid)
        return false;
      throw new exception("unacceptable kind of an object to dump " + type2);
    }
    if (state.tag !== null && state.tag !== "?") {
      tagStr = encodeURI(state.tag[0] === "!" ? state.tag.slice(1) : state.tag).replace(/!/g, "%21");
      if (state.tag[0] === "!") {
        tagStr = "!" + tagStr;
      } else if (tagStr.slice(0, 18) === "tag:yaml.org,2002:") {
        tagStr = "!!" + tagStr.slice(18);
      } else {
        tagStr = "!<" + tagStr + ">";
      }
      state.dump = tagStr + " " + state.dump;
    }
  }
  return true;
}
function getDuplicateReferences(object, state) {
  var objects = [], duplicatesIndexes = [], index, length;
  inspectNode(object, objects, duplicatesIndexes);
  for (index = 0, length = duplicatesIndexes.length;index < length; index += 1) {
    state.duplicates.push(objects[duplicatesIndexes[index]]);
  }
  state.usedDuplicates = new Array(length);
}
function inspectNode(object, objects, duplicatesIndexes) {
  var objectKeyList, index, length;
  if (object !== null && typeof object === "object") {
    index = objects.indexOf(object);
    if (index !== -1) {
      if (duplicatesIndexes.indexOf(index) === -1) {
        duplicatesIndexes.push(index);
      }
    } else {
      objects.push(object);
      if (Array.isArray(object)) {
        for (index = 0, length = object.length;index < length; index += 1) {
          inspectNode(object[index], objects, duplicatesIndexes);
        }
      } else {
        objectKeyList = Object.keys(object);
        for (index = 0, length = objectKeyList.length;index < length; index += 1) {
          inspectNode(object[objectKeyList[index]], objects, duplicatesIndexes);
        }
      }
    }
  }
}
function dump$1(input, options) {
  options = options || {};
  var state = new State(options);
  if (!state.noRefs)
    getDuplicateReferences(input, state);
  var value = input;
  if (state.replacer) {
    value = state.replacer.call({ "": value }, "", value);
  }
  if (writeNode(state, 0, value, true, true))
    return state.dump + `
`;
  return "";
}
function renamed(from, to) {
  return function() {
    throw new Error("Function yaml." + from + " is removed in js-yaml 4. " + "Use yaml." + to + " instead, which is now safe by default.");
  };
}
var isNothing_1, isObject_1, toArray_1, repeat_1, isNegativeZero_1, extend_1, common, exception, snippet, TYPE_CONSTRUCTOR_OPTIONS, YAML_NODE_KINDS, type, schema, str, seq, map, failsafe, _null, bool, int, YAML_FLOAT_PATTERN, SCIENTIFIC_WITHOUT_DOT, float, json, core, YAML_DATE_REGEXP, YAML_TIMESTAMP_REGEXP, timestamp, merge, BASE64_MAP = `ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=
\r`, binary, _hasOwnProperty$3, _toString$2, omap, _toString$1, pairs, _hasOwnProperty$2, set, _default, _hasOwnProperty$1, CONTEXT_FLOW_IN = 1, CONTEXT_FLOW_OUT = 2, CONTEXT_BLOCK_IN = 3, CONTEXT_BLOCK_OUT = 4, CHOMPING_CLIP = 1, CHOMPING_STRIP = 2, CHOMPING_KEEP = 3, PATTERN_NON_PRINTABLE, PATTERN_NON_ASCII_LINE_BREAKS, PATTERN_FLOW_INDICATORS, PATTERN_TAG_HANDLE, PATTERN_TAG_URI, simpleEscapeCheck, simpleEscapeMap, i, directiveHandlers, loadAll_1, load_1, loader, _toString, _hasOwnProperty, CHAR_BOM = 65279, CHAR_TAB = 9, CHAR_LINE_FEED = 10, CHAR_CARRIAGE_RETURN = 13, CHAR_SPACE = 32, CHAR_EXCLAMATION = 33, CHAR_DOUBLE_QUOTE = 34, CHAR_SHARP = 35, CHAR_PERCENT = 37, CHAR_AMPERSAND = 38, CHAR_SINGLE_QUOTE = 39, CHAR_ASTERISK = 42, CHAR_COMMA = 44, CHAR_MINUS = 45, CHAR_COLON = 58, CHAR_EQUALS = 61, CHAR_GREATER_THAN = 62, CHAR_QUESTION = 63, CHAR_COMMERCIAL_AT = 64, CHAR_LEFT_SQUARE_BRACKET = 91, CHAR_RIGHT_SQUARE_BRACKET = 93, CHAR_GRAVE_ACCENT = 96, CHAR_LEFT_CURLY_BRACKET = 123, CHAR_VERTICAL_LINE = 124, CHAR_RIGHT_CURLY_BRACKET = 125, ESCAPE_SEQUENCES, DEPRECATED_BOOLEANS_SYNTAX, DEPRECATED_BASE60_SYNTAX, QUOTING_TYPE_SINGLE = 1, QUOTING_TYPE_DOUBLE = 2, STYLE_PLAIN = 1, STYLE_SINGLE = 2, STYLE_LITERAL = 3, STYLE_FOLDED = 4, STYLE_DOUBLE = 5, dump_1, dumper, load, loadAll, dump, safeLoad, safeLoadAll, safeDump;
var init_js_yaml = __esm(() => {
  /*! js-yaml 4.1.1 https://github.com/nodeca/js-yaml @license MIT */
  isNothing_1 = isNothing;
  isObject_1 = isObject;
  toArray_1 = toArray;
  repeat_1 = repeat;
  isNegativeZero_1 = isNegativeZero;
  extend_1 = extend;
  common = {
    isNothing: isNothing_1,
    isObject: isObject_1,
    toArray: toArray_1,
    repeat: repeat_1,
    isNegativeZero: isNegativeZero_1,
    extend: extend_1
  };
  YAMLException$1.prototype = Object.create(Error.prototype);
  YAMLException$1.prototype.constructor = YAMLException$1;
  YAMLException$1.prototype.toString = function toString(compact) {
    return this.name + ": " + formatError(this, compact);
  };
  exception = YAMLException$1;
  snippet = makeSnippet;
  TYPE_CONSTRUCTOR_OPTIONS = [
    "kind",
    "multi",
    "resolve",
    "construct",
    "instanceOf",
    "predicate",
    "represent",
    "representName",
    "defaultStyle",
    "styleAliases"
  ];
  YAML_NODE_KINDS = [
    "scalar",
    "sequence",
    "mapping"
  ];
  type = Type$1;
  Schema$1.prototype.extend = function extend2(definition) {
    var implicit = [];
    var explicit = [];
    if (definition instanceof type) {
      explicit.push(definition);
    } else if (Array.isArray(definition)) {
      explicit = explicit.concat(definition);
    } else if (definition && (Array.isArray(definition.implicit) || Array.isArray(definition.explicit))) {
      if (definition.implicit)
        implicit = implicit.concat(definition.implicit);
      if (definition.explicit)
        explicit = explicit.concat(definition.explicit);
    } else {
      throw new exception("Schema.extend argument should be a Type, [ Type ], " + "or a schema definition ({ implicit: [...], explicit: [...] })");
    }
    implicit.forEach(function(type$1) {
      if (!(type$1 instanceof type)) {
        throw new exception("Specified list of YAML types (or a single Type object) contains a non-Type object.");
      }
      if (type$1.loadKind && type$1.loadKind !== "scalar") {
        throw new exception("There is a non-scalar type in the implicit list of a schema. Implicit resolving of such types is not supported.");
      }
      if (type$1.multi) {
        throw new exception("There is a multi type in the implicit list of a schema. Multi tags can only be listed as explicit.");
      }
    });
    explicit.forEach(function(type$1) {
      if (!(type$1 instanceof type)) {
        throw new exception("Specified list of YAML types (or a single Type object) contains a non-Type object.");
      }
    });
    var result = Object.create(Schema$1.prototype);
    result.implicit = (this.implicit || []).concat(implicit);
    result.explicit = (this.explicit || []).concat(explicit);
    result.compiledImplicit = compileList(result, "implicit");
    result.compiledExplicit = compileList(result, "explicit");
    result.compiledTypeMap = compileMap(result.compiledImplicit, result.compiledExplicit);
    return result;
  };
  schema = Schema$1;
  str = new type("tag:yaml.org,2002:str", {
    kind: "scalar",
    construct: function(data) {
      return data !== null ? data : "";
    }
  });
  seq = new type("tag:yaml.org,2002:seq", {
    kind: "sequence",
    construct: function(data) {
      return data !== null ? data : [];
    }
  });
  map = new type("tag:yaml.org,2002:map", {
    kind: "mapping",
    construct: function(data) {
      return data !== null ? data : {};
    }
  });
  failsafe = new schema({
    explicit: [
      str,
      seq,
      map
    ]
  });
  _null = new type("tag:yaml.org,2002:null", {
    kind: "scalar",
    resolve: resolveYamlNull,
    construct: constructYamlNull,
    predicate: isNull,
    represent: {
      canonical: function() {
        return "~";
      },
      lowercase: function() {
        return "null";
      },
      uppercase: function() {
        return "NULL";
      },
      camelcase: function() {
        return "Null";
      },
      empty: function() {
        return "";
      }
    },
    defaultStyle: "lowercase"
  });
  bool = new type("tag:yaml.org,2002:bool", {
    kind: "scalar",
    resolve: resolveYamlBoolean,
    construct: constructYamlBoolean,
    predicate: isBoolean,
    represent: {
      lowercase: function(object) {
        return object ? "true" : "false";
      },
      uppercase: function(object) {
        return object ? "TRUE" : "FALSE";
      },
      camelcase: function(object) {
        return object ? "True" : "False";
      }
    },
    defaultStyle: "lowercase"
  });
  int = new type("tag:yaml.org,2002:int", {
    kind: "scalar",
    resolve: resolveYamlInteger,
    construct: constructYamlInteger,
    predicate: isInteger,
    represent: {
      binary: function(obj) {
        return obj >= 0 ? "0b" + obj.toString(2) : "-0b" + obj.toString(2).slice(1);
      },
      octal: function(obj) {
        return obj >= 0 ? "0o" + obj.toString(8) : "-0o" + obj.toString(8).slice(1);
      },
      decimal: function(obj) {
        return obj.toString(10);
      },
      hexadecimal: function(obj) {
        return obj >= 0 ? "0x" + obj.toString(16).toUpperCase() : "-0x" + obj.toString(16).toUpperCase().slice(1);
      }
    },
    defaultStyle: "decimal",
    styleAliases: {
      binary: [2, "bin"],
      octal: [8, "oct"],
      decimal: [10, "dec"],
      hexadecimal: [16, "hex"]
    }
  });
  YAML_FLOAT_PATTERN = new RegExp("^(?:[-+]?(?:[0-9][0-9_]*)(?:\\.[0-9_]*)?(?:[eE][-+]?[0-9]+)?" + "|\\.[0-9_]+(?:[eE][-+]?[0-9]+)?" + "|[-+]?\\.(?:inf|Inf|INF)" + "|\\.(?:nan|NaN|NAN))$");
  SCIENTIFIC_WITHOUT_DOT = /^[-+]?[0-9]+e/;
  float = new type("tag:yaml.org,2002:float", {
    kind: "scalar",
    resolve: resolveYamlFloat,
    construct: constructYamlFloat,
    predicate: isFloat,
    represent: representYamlFloat,
    defaultStyle: "lowercase"
  });
  json = failsafe.extend({
    implicit: [
      _null,
      bool,
      int,
      float
    ]
  });
  core = json;
  YAML_DATE_REGEXP = new RegExp("^([0-9][0-9][0-9][0-9])" + "-([0-9][0-9])" + "-([0-9][0-9])$");
  YAML_TIMESTAMP_REGEXP = new RegExp("^([0-9][0-9][0-9][0-9])" + "-([0-9][0-9]?)" + "-([0-9][0-9]?)" + "(?:[Tt]|[ \\t]+)" + "([0-9][0-9]?)" + ":([0-9][0-9])" + ":([0-9][0-9])" + "(?:\\.([0-9]*))?" + "(?:[ \\t]*(Z|([-+])([0-9][0-9]?)" + "(?::([0-9][0-9]))?))?$");
  timestamp = new type("tag:yaml.org,2002:timestamp", {
    kind: "scalar",
    resolve: resolveYamlTimestamp,
    construct: constructYamlTimestamp,
    instanceOf: Date,
    represent: representYamlTimestamp
  });
  merge = new type("tag:yaml.org,2002:merge", {
    kind: "scalar",
    resolve: resolveYamlMerge
  });
  binary = new type("tag:yaml.org,2002:binary", {
    kind: "scalar",
    resolve: resolveYamlBinary,
    construct: constructYamlBinary,
    predicate: isBinary,
    represent: representYamlBinary
  });
  _hasOwnProperty$3 = Object.prototype.hasOwnProperty;
  _toString$2 = Object.prototype.toString;
  omap = new type("tag:yaml.org,2002:omap", {
    kind: "sequence",
    resolve: resolveYamlOmap,
    construct: constructYamlOmap
  });
  _toString$1 = Object.prototype.toString;
  pairs = new type("tag:yaml.org,2002:pairs", {
    kind: "sequence",
    resolve: resolveYamlPairs,
    construct: constructYamlPairs
  });
  _hasOwnProperty$2 = Object.prototype.hasOwnProperty;
  set = new type("tag:yaml.org,2002:set", {
    kind: "mapping",
    resolve: resolveYamlSet,
    construct: constructYamlSet
  });
  _default = core.extend({
    implicit: [
      timestamp,
      merge
    ],
    explicit: [
      binary,
      omap,
      pairs,
      set
    ]
  });
  _hasOwnProperty$1 = Object.prototype.hasOwnProperty;
  PATTERN_NON_PRINTABLE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x84\x86-\x9F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/;
  PATTERN_NON_ASCII_LINE_BREAKS = /[\x85\u2028\u2029]/;
  PATTERN_FLOW_INDICATORS = /[,\[\]\{\}]/;
  PATTERN_TAG_HANDLE = /^(?:!|!!|![a-z\-]+!)$/i;
  PATTERN_TAG_URI = /^(?:!|[^,\[\]\{\}])(?:%[0-9a-f]{2}|[0-9a-z\-#;\/\?:@&=\+\$,_\.!~\*'\(\)\[\]])*$/i;
  simpleEscapeCheck = new Array(256);
  simpleEscapeMap = new Array(256);
  for (i = 0;i < 256; i++) {
    simpleEscapeCheck[i] = simpleEscapeSequence(i) ? 1 : 0;
    simpleEscapeMap[i] = simpleEscapeSequence(i);
  }
  directiveHandlers = {
    YAML: function handleYamlDirective(state, name, args) {
      var match, major, minor;
      if (state.version !== null) {
        throwError(state, "duplication of %YAML directive");
      }
      if (args.length !== 1) {
        throwError(state, "YAML directive accepts exactly one argument");
      }
      match = /^([0-9]+)\.([0-9]+)$/.exec(args[0]);
      if (match === null) {
        throwError(state, "ill-formed argument of the YAML directive");
      }
      major = parseInt(match[1], 10);
      minor = parseInt(match[2], 10);
      if (major !== 1) {
        throwError(state, "unacceptable YAML version of the document");
      }
      state.version = args[0];
      state.checkLineBreaks = minor < 2;
      if (minor !== 1 && minor !== 2) {
        throwWarning(state, "unsupported YAML version of the document");
      }
    },
    TAG: function handleTagDirective(state, name, args) {
      var handle, prefix;
      if (args.length !== 2) {
        throwError(state, "TAG directive accepts exactly two arguments");
      }
      handle = args[0];
      prefix = args[1];
      if (!PATTERN_TAG_HANDLE.test(handle)) {
        throwError(state, "ill-formed tag handle (first argument) of the TAG directive");
      }
      if (_hasOwnProperty$1.call(state.tagMap, handle)) {
        throwError(state, 'there is a previously declared suffix for "' + handle + '" tag handle');
      }
      if (!PATTERN_TAG_URI.test(prefix)) {
        throwError(state, "ill-formed tag prefix (second argument) of the TAG directive");
      }
      try {
        prefix = decodeURIComponent(prefix);
      } catch (err) {
        throwError(state, "tag prefix is malformed: " + prefix);
      }
      state.tagMap[handle] = prefix;
    }
  };
  loadAll_1 = loadAll$1;
  load_1 = load$1;
  loader = {
    loadAll: loadAll_1,
    load: load_1
  };
  _toString = Object.prototype.toString;
  _hasOwnProperty = Object.prototype.hasOwnProperty;
  ESCAPE_SEQUENCES = {};
  ESCAPE_SEQUENCES[0] = "\\0";
  ESCAPE_SEQUENCES[7] = "\\a";
  ESCAPE_SEQUENCES[8] = "\\b";
  ESCAPE_SEQUENCES[9] = "\\t";
  ESCAPE_SEQUENCES[10] = "\\n";
  ESCAPE_SEQUENCES[11] = "\\v";
  ESCAPE_SEQUENCES[12] = "\\f";
  ESCAPE_SEQUENCES[13] = "\\r";
  ESCAPE_SEQUENCES[27] = "\\e";
  ESCAPE_SEQUENCES[34] = "\\\"";
  ESCAPE_SEQUENCES[92] = "\\\\";
  ESCAPE_SEQUENCES[133] = "\\N";
  ESCAPE_SEQUENCES[160] = "\\_";
  ESCAPE_SEQUENCES[8232] = "\\L";
  ESCAPE_SEQUENCES[8233] = "\\P";
  DEPRECATED_BOOLEANS_SYNTAX = [
    "y",
    "Y",
    "yes",
    "Yes",
    "YES",
    "on",
    "On",
    "ON",
    "n",
    "N",
    "no",
    "No",
    "NO",
    "off",
    "Off",
    "OFF"
  ];
  DEPRECATED_BASE60_SYNTAX = /^[-+]?[0-9_]+(?::[0-9_]+)+(?:\.[0-9_]*)?$/;
  dump_1 = dump$1;
  dumper = {
    dump: dump_1
  };
  load = loader.load;
  loadAll = loader.loadAll;
  dump = dumper.dump;
  safeLoad = renamed("safeLoad", "load");
  safeLoadAll = renamed("safeLoadAll", "loadAll");
  safeDump = renamed("safeDump", "dump");
});

// hooks/lib/spec-io.mjs
import { existsSync as existsSync5, readFileSync as readFileSync8, statSync as statSync2, readdirSync as readdirSync6 } from "fs";
import { join as join3, dirname as dirname2, relative, basename } from "path";
function parseYamlFrontmatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m)
    return { data: {}, body: content };
  try {
    const parsed = load(m[1]);
    const data = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    return { data, body: m[2] };
  } catch (e) {
    return { data: {}, body: content, parseError: e };
  }
}
function specDirPath(projectRoot) {
  return join3(projectRoot, "doc", "specs");
}
function isRequirementsDoc(relPath) {
  return relPath === "requirements.md" || relPath.endsWith("/requirements.md") || relPath === "constraints.md" || relPath.endsWith("/constraints.md") || relPath.startsWith("requirements/") || relPath.includes("/requirements/");
}
function walkSpecFiles(sd) {
  const results = [];
  function walk(dir) {
    let entries;
    try {
      entries = readdirSync6(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".") || e.name === "_generated")
        continue;
      const full = join3(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else if (e.isFile() && e.name.endsWith(".md")) {
        results.push({ absPath: full, relPath: relative(sd, full) });
      }
    }
  }
  walk(sd);
  return results;
}
function hasNormativeVerb(text) {
  return /\*\*shall( not)?\*\*|\*\*shall\*\* not\b/.test(text);
}
function extractRefs(content, selfId) {
  const re = new RegExp(ID_RE_SRC, "g");
  const refs = new Set;
  let m;
  while ((m = re.exec(content)) !== null) {
    if (m[1] !== selfId)
      refs.add(m[1]);
  }
  return [...refs];
}
function parseBulletItems(sectionBody) {
  const items = [];
  const lines = sectionBody.split(`
`);
  let current = null;
  for (const line of lines) {
    if (line.startsWith("- ") || line.startsWith("* ")) {
      if (current !== null)
        items.push(current);
      current = { raw: line.slice(2) };
    } else if (current !== null && (line.startsWith("  ") || line.startsWith("\t"))) {
      current.raw += " " + line.trim();
    } else {
      if (current !== null)
        items.push(current);
      current = null;
    }
  }
  if (current !== null)
    items.push(current);
  return items;
}
function extractAttributeLine(sectionBody) {
  const re1 = /^\*\*Verification\*\*\s+(\S+)\s*[\u00B7\u2022]\s*\*\*Criticality\*\*\s+(\S+)\s*[\u00B7\u2022]\s*\*\*Source\*\*\s+(\S+)/;
  const re2v = /^\*\*Verification\*\*\s*:\s*(\S+)/;
  const re2c = /^\*\*Criticality\*\*\s*:\s*(\S+)/;
  const re2s = /^\*\*Source\*\*\s*:\s*(\S+)/;
  let form2v = null, form2c = null, form2s = null;
  for (const line of sectionBody.split(`
`)) {
    const bare = /^\s*[-*]\s+/.test(line) ? line.replace(/^\s*[-*]\s+/, "") : line;
    const m1 = bare.match(re1);
    if (m1)
      return { verification: m1[1], criticality: m1[2], source: m1[3] };
    const mv = bare.match(re2v);
    if (mv && !form2v)
      form2v = mv[1];
    const mc = bare.match(re2c);
    if (mc && !form2c)
      form2c = mc[1];
    const ms = bare.match(re2s);
    if (ms && !form2s)
      form2s = ms[1];
  }
  if (form2v || form2c) {
    return { verification: form2v ?? "unknown", criticality: form2c ?? "unknown", source: form2s ?? "" };
  }
  return null;
}
function extractSeeAlso(sectionBody) {
  const hrefs = [];
  const items = parseBulletItems(sectionBody);
  const seeAlsoItem = items.find((it) => it.raw.startsWith("**See also**"));
  if (!seeAlsoItem)
    return hrefs;
  const re = /\[([^\]]+)\]\(#([^)]+)\)/g;
  let m;
  while ((m = re.exec(seeAlsoItem.raw)) !== null) {
    hrefs.push(m[2]);
  }
  return hrefs;
}
function parseRequirementsDocument(markdown) {
  const { body } = parseYamlFrontmatter(markdown);
  const sections = [];
  const chunks = body.split(/^(?=#{2,3} )/m);
  const HEADING_RE = /^#{2,3} ([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-R-\S+)\s+[\u2014\u2013]\s+(.+?)\s+\{#([^}]+)\}\s*(?:\n|$)/;
  for (const chunk of chunks) {
    if (!chunk.startsWith("## ") && !chunk.startsWith("### "))
      continue;
    const headingLine = chunk.split(`
`)[0] + `
`;
    const hm = headingLine.match(HEADING_RE);
    if (!hm)
      continue;
    const id = hm[1];
    const title = hm[2].trim();
    const anchor = hm[3].trim();
    const sectionBody = chunk.slice(headingLine.trimEnd().length).trim();
    const errors = [];
    if (anchor !== id.toLowerCase()) {
      errors.push(`anchor {#${anchor}} does not match id ${id} lowercased (expected {#${id.toLowerCase()}})`);
    }
    const normativeStatement = (() => {
      const lines = sectionBody.split(`
`);
      const stmtLines = [];
      for (const line of lines) {
        if (line.startsWith("- ") || line.startsWith("* "))
          break;
        stmtLines.push(line);
      }
      const stmt = stmtLines.join(`
`).trim();
      return stmt || null;
    })();
    if (!normativeStatement) {
      errors.push("missing normative statement (no prose between heading and first bullet)");
    } else if (!hasNormativeVerb(normativeStatement)) {
      errors.push("normative statement does not contain bolded **shall**");
    }
    const items = parseBulletItems(sectionBody);
    const whyItem = items.find((it) => it.raw.startsWith("**Why**"));
    const why = whyItem ? whyItem.raw.replace(/^\*\*Why\*\*\s*[\u2014\u2013]\s*/, "").trim() : null;
    if (!why)
      errors.push("missing **Why** rationale bullet");
    const fitItem = items.find((it) => it.raw.startsWith("**Fit criterion**"));
    const fitCriterion = fitItem ? fitItem.raw.replace(/^\*\*Fit criterion\*\*\s*[\u2014\u2013]\s*/, "").trim() : null;
    if (!fitCriterion)
      errors.push("missing **Fit criterion** bullet");
    const attr = extractAttributeLine(sectionBody);
    const verification = attr?.verification ?? null;
    const criticality = attr?.criticality ?? null;
    const source = attr?.source ?? null;
    const seeAlso = extractSeeAlso(sectionBody);
    const refs = extractRefs(sectionBody, id);
    sections.push({
      id,
      title,
      anchor,
      normativeStatement,
      why,
      fitCriterion,
      verification,
      criticality,
      source,
      seeAlso,
      refs,
      errors
    });
  }
  return sections;
}
function parseSpecRequirements(projectDir) {
  const sd = specDirPath(projectDir);
  if (!existsSync5(sd))
    return [];
  const results = [];
  for (const { absPath, relPath } of walkSpecFiles(sd)) {
    if (!isRequirementsDoc(relPath))
      continue;
    try {
      const markdown = readFileSync8(absPath, "utf8");
      const reqs = parseRequirementsDocument(markdown);
      for (const r of reqs) {
        if (r.errors?.length && !r.id)
          continue;
        results.push(r);
      }
    } catch {}
  }
  return results;
}
var ALLOWED_FRONTMATTER_FIELDS, CORE_VIEW_TYPES, ID_RE_SRC = "\\b([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-R-[a-z0-9]+|C-[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*)\\b";
var init_spec_io = __esm(() => {
  init_js_yaml();
  init_schema_io();
  ALLOWED_FRONTMATTER_FIELDS = new Set([
    "id",
    "type",
    "concept",
    "parent",
    "title",
    "summary",
    "origin_decision_ref",
    "status",
    "pattern",
    "verification",
    "criticality",
    "ears_pattern",
    "verification_method",
    "source",
    "verifies",
    "tags",
    "aliases",
    "depends_on",
    "date_updated",
    "design"
  ]);
  CORE_VIEW_TYPES = new Set([
    "overview",
    "data-model",
    "flows",
    "api",
    "constraints",
    "scenarios",
    "cases"
  ]);
});

// hooks/lib/traceability-adapter.mjs
var exports_traceability_adapter = {};
__export(exports_traceability_adapter, {
  NativeSpineAdapter: () => NativeSpineAdapter
});
import { readFileSync as readFileSync9, existsSync as existsSync6, readdirSync as readdirSync7, statSync as statSync3 } from "fs";
import path6 from "path";

class NativeSpineAdapter {
  constructor({ projectDir, slug }) {
    this._projectDir = projectDir;
    this._slug = slug;
  }
  getObjective() {
    const motive = this._readMotive();
    return motive.objective ?? "";
  }
  getMotive() {
    return this._slug;
  }
  getSlices() {
    const ledger = this._readLedger();
    if (!ledger)
      return [];
    const slices = Array.isArray(ledger.slices) ? ledger.slices : [];
    return slices.map((s) => ({
      id: s.id ?? "",
      status: s.status ?? "pending",
      blocked_by: normStringArray(s.blocked_by),
      covers_ac: normStringArray(s.covers_ac),
      decisions: normStringArray(s.decisions),
      test_paths: normStringArray(s.test_paths),
      wave: typeof s.wave === "number" ? s.wave : null,
      ticket: typeof s.ticket === "string" ? s.ticket : undefined,
      desc: typeof s.desc === "string" ? s.desc : undefined
    }));
  }
  getVerificationEvents() {
    const events = this._readJournalEvents();
    const out = [];
    let ord = 0;
    for (const ev of events) {
      if (ev.type !== "VERIFICATION")
        continue;
      const d = ev.data ?? {};
      out.push({
        claim: typeof d.claim === "string" ? d.claim : null,
        evidence: typeof d.evidence === "string" ? d.evidence : null,
        result: typeof d.result === "string" ? d.result : null,
        ord: ord++,
        linkId: typeof d.link_id === "string" ? d.link_id : null
      });
    }
    return out;
  }
  getGateEvents() {
    const events = this._readJournalEvents();
    const out = [];
    for (const ev of events) {
      if (ev.type !== "GATE")
        continue;
      const d = ev.data ?? {};
      const which = typeof d.which === "string" ? d.which : typeof d.gate === "string" ? d.gate : "unknown";
      const verdict = typeof d.verdict === "string" ? d.verdict : "unknown";
      out.push({
        which,
        verdict,
        citation: typeof d.citation === "string" ? d.citation : null,
        rubric: typeof d.rubric === "string" ? d.rubric : null,
        linkId: typeof d.link_id === "string" ? d.link_id : null
      });
    }
    return out;
  }
  getSpecRequirements() {
    const reqs = parseSpecRequirements(this._projectDir);
    return reqs.map((r) => ({
      id: r.id ?? "",
      title: r.title ?? "",
      verification: r.verification ?? null,
      criticality: r.criticality ?? null,
      origin_decision_ref: r.originDecisionRef ?? r.origin_decision_ref ?? null
    }));
  }
  getCoverageMap() {
    const map2 = {};
    for (const r of this.getSpecRequirements()) {
      map2[r.id] = { declared: r.verification ?? null, verified: false, tests: [] };
    }
    const covPath = path6.join(this._projectDir, "doc", "specs", "_generated", "coverage.json");
    if (existsSync6(covPath)) {
      try {
        const cov = JSON.parse(readFileSync9(covPath, "utf8"));
        const byReq = cov.by_requirement ?? {};
        for (const [reqId, entry] of Object.entries(byReq)) {
          if (map2[reqId]) {
            map2[reqId].tests = Array.isArray(entry.tests) ? entry.tests : [];
            map2[reqId].verified = Boolean(entry.verified);
          }
        }
      } catch {}
    }
    return map2;
  }
  _readLedger() {
    const runsDir = path6.join(this._projectDir, ".groundwork", "runs");
    if (existsSync6(runsDir)) {
      try {
        const files = readdirSync7(runsDir).filter((f) => f.endsWith(".json")).map((f) => ({ f, mt: statSync3(path6.join(runsDir, f)).mtimeMs })).sort((a, b) => b.mt - a.mt);
        for (const { f } of files) {
          try {
            const ledger = JSON.parse(readFileSync9(path6.join(runsDir, f), "utf8"));
            const _refSlug = ledger.motive_ref ? resolveMotiveSlug(ledger.motive_ref) : null;
            if (this._slug && _refSlug !== null && _refSlug !== this._slug)
              continue;
            if (ledger.active !== false)
              return ledger;
          } catch {}
        }
      } catch {}
    }
    const legacy = path6.join(this._projectDir, ".groundwork", "run.json");
    if (existsSync6(legacy)) {
      try {
        return JSON.parse(readFileSync9(legacy, "utf8"));
      } catch {}
    }
    return null;
  }
  _readJournalEvents() {
    const journalDir = path6.join(this._projectDir, ".groundwork", "journal");
    if (!existsSync6(journalDir))
      return [];
    const events = [];
    try {
      const files = readdirSync7(journalDir).filter((f) => f.endsWith(".jsonl")).sort();
      for (const f of files) {
        const raw = readFileSync9(path6.join(journalDir, f), "utf8");
        for (const line of raw.split(`
`)) {
          const l = line.trim();
          if (!l)
            continue;
          try {
            const ev = JSON.parse(l);
            if (this._slug && ev.motive && ev.motive !== this._slug)
              continue;
            events.push(ev);
          } catch {}
        }
      }
    } catch {}
    return events;
  }
  _readMotive() {
    const motiveFile = path6.join(this._projectDir, ".groundwork", "motives", this._slug, "motive.md");
    if (!existsSync6(motiveFile))
      return {};
    try {
      const md = readFileSync9(motiveFile, "utf8");
      const m = md.match(/##\s+Objective\s*\n+([\s\S]*?)(?:\n##|\s*$)/);
      return { objective: m ? m[1].trim() : undefined };
    } catch {
      return {};
    }
  }
}
function normStringArray(v) {
  if (Array.isArray(v))
    return v.filter((x) => typeof x === "string");
  if (typeof v === "string" && v)
    return [v];
  return [];
}
var init_traceability_adapter = __esm(() => {
  init_spec_io();
});

// hooks/ledger.mjs
import { existsSync as existsSync8, mkdirSync as mkdirSync5, readFileSync as readFileSync10, writeFileSync as writeFileSync6 } from "fs";
import path7 from "path";
import { randomBytes as randomBytes2 } from "crypto";
import { spawnSync } from "child_process";

// hooks/lib/ledger-io.mjs
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "fs";
import { randomUUID } from "crypto";
import path from "path";
function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {}
}
function atomicWriteFileSync(filePath, data) {
  const dir = path.dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.tmp.${randomUUID()}`);
  const fd = openSync(tmp, "w");
  try {
    writeFileSync(fd, data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, filePath);
  try {
    const dfd = openSync(dir, "r");
    try {
      fsyncSync(dfd);
    } finally {
      closeSync(dfd);
    }
  } catch {}
}
function atomicWriteJsonSync(filePath, obj) {
  atomicWriteFileSync(filePath, `${JSON.stringify(obj, null, 2)}
`);
}
function withLock(targetPath, fn, { retries = 100, delayMs = 20, staleMs = 5000 } = {}) {
  const lockPath = `${targetPath}.lock`;
  mkdirSync(path.dirname(targetPath), { recursive: true });
  let fd = null;
  for (let i = 0;fd === null; i++) {
    try {
      fd = openSync(lockPath, "wx");
    } catch (e) {
      if (e?.code !== "EEXIST")
        throw e;
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > staleMs) {
          unlinkSync(lockPath);
          continue;
        }
      } catch {}
      if (i >= retries)
        throw new Error(`ledger lock timeout: ${lockPath}`);
      sleepSync(delayMs);
    }
  }
  try {
    return fn();
  } finally {
    try {
      closeSync(fd);
    } catch {}
    try {
      unlinkSync(lockPath);
    } catch {}
  }
}
function mutateLedger(ledgerPath, fn) {
  return withLock(ledgerPath, () => {
    let ledger = null;
    try {
      ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
    } catch {
      ledger = null;
    }
    const returned = fn(ledger);
    const next = returned === undefined ? ledger : returned;
    if (next != null)
      atomicWriteJsonSync(ledgerPath, next);
    return next;
  });
}
function readLedger(ledgerPath) {
  try {
    return JSON.parse(readFileSync(ledgerPath, "utf8"));
  } catch {
    return null;
  }
}
function resolveLedgerPath({ projectDir, sessionId } = {}) {
  const legacyPath = path.join(projectDir, ".groundwork", "run.json");
  if (!sessionId || typeof sessionId !== "string")
    return legacyPath;
  const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
  if (!SAFE_ID.test(sessionId))
    return legacyPath;
  const perSessionPath = path.join(projectDir, ".groundwork", "runs", `${sessionId}.json`);
  if (existsSync(perSessionPath))
    return perSessionPath;
  if (existsSync(legacyPath)) {
    let legacy = null;
    try {
      legacy = JSON.parse(readFileSync(legacyPath, "utf8"));
    } catch {}
    const legacyOwner = legacy?.session_id;
    if (!legacyOwner || legacyOwner === sessionId)
      return legacyPath;
  }
  return perSessionPath;
}
function pruneStaleSessionLedgers(projectDir) {
  const runsDir = path.join(projectDir, ".groundwork", "runs");
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  function pruneFile(fp) {
    unlinkSync(fp);
    const keyPath = fp.replace(/\.json$/, ".seal.key");
    try {
      unlinkSync(keyPath);
    } catch {}
  }
  try {
    const files = readdirSync(runsDir).filter((f) => f.endsWith(".json"));
    for (const f of files) {
      const fp = path.join(runsDir, f);
      try {
        const st = statSync(fp);
        if (Date.now() - st.mtimeMs > sevenDaysMs) {
          pruneFile(fp);
          continue;
        }
        const obj = JSON.parse(readFileSync(fp, "utf8"));
        if (obj.active === false)
          pruneFile(fp);
      } catch {}
    }
  } catch {}
}

// hooks/lib/gate-seal.mjs
import { createHmac, timingSafeEqual, randomBytes } from "crypto";
import { readFileSync as readFileSync2, writeFileSync as writeFileSync2, existsSync as existsSync2, mkdirSync as mkdirSync2 } from "fs";
import path2 from "path";
var SCHEMA_VERSION = 1;
var SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
function extractAdvisorVerdict(gate) {
  const a = gate?.advisor;
  if (!a)
    return null;
  if (typeof a === "string")
    return a;
  if (typeof a === "object" && a.verdict != null)
    return String(a.verdict);
  return null;
}
function canonicalReleaseState(ledger) {
  const slices = Array.isArray(ledger.slices) ? ledger.slices : [];
  const sortedSlices = slices.map((s) => ({ id: String(s.id), status: String(s.status), created_by: s.created_by ?? null })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const state = {
    schema_version: ledger.schema_version ?? null,
    session_id: ledger.session_id ?? null,
    active: ledger.active ?? null,
    advisor_verdict: extractAdvisorVerdict(ledger.gate),
    slices: sortedSlices
  };
  if (ledger.scoped_tokens !== undefined) {
    const rawTokens = Array.isArray(ledger.scoped_tokens) ? ledger.scoped_tokens : [];
    state.scoped_tokens = rawTokens.map((t) => ({ scope: String(t.scope ?? ""), token: String(t.token ?? "") })).sort((a, b) => a.scope < b.scope ? -1 : a.scope > b.scope ? 1 : a.token < b.token ? -1 : a.token > b.token ? 1 : 0);
  }
  if (ledger.awaiting_human !== undefined) {
    state.awaiting_human = ledger.awaiting_human === true;
  }
  if (ledger.pacing?.milestone_signoff !== undefined) {
    const ms = ledger.pacing.milestone_signoff;
    state.milestone_signoff = {
      verdict: String(ms.verdict ?? ""),
      verified_by: String(ms.verified_by ?? ""),
      verified_at: String(ms.verified_at ?? "")
    };
  }
  return JSON.stringify(state);
}
function computeSeal(stateString, key) {
  const keyBuf = Buffer.isBuffer(key) ? key : Buffer.from(key, "hex");
  return createHmac("sha256", keyBuf).update(stateString, "utf8").digest("hex");
}
function keyPath({ projectDir, sessionId } = {}) {
  if (sessionId && typeof sessionId === "string" && SAFE_ID.test(sessionId)) {
    return path2.join(projectDir, ".groundwork", "runs", `${sessionId}.seal.key`);
  }
  return path2.join(projectDir, ".groundwork", "runs", "legacy.seal.key");
}
function ensureKey({ projectDir, sessionId }) {
  const kp = keyPath({ projectDir, sessionId });
  if (existsSync2(kp)) {
    return readFileSync2(kp);
  }
  mkdirSync2(path2.dirname(kp), { recursive: true });
  const key = randomBytes(32);
  writeFileSync2(kp, key, { mode: 384 });
  return key;
}
function readKey({ projectDir, sessionId }) {
  const kp = keyPath({ projectDir, sessionId });
  return readFileSync2(kp);
}

// hooks/lib/pacing.mjs
function getPacing(doc) {
  return doc?.pacing ?? null;
}
function getSlices(doc) {
  return Array.isArray(doc?.slices) ? doc.slices : [];
}
function isExemptSlice(slice, exemptKinds) {
  return exemptKinds.includes(slice.kind ?? "");
}
var STALEABLE_ARTIFACT_KINDS = ["screenshot", "run_output"];
var KNOWN_ARTIFACT_KINDS = ["screenshot", "run_output", "live_url", "file"];
function resolveUnit(doc, sliceId) {
  const pacing = getPacing(doc);
  if (!pacing)
    return null;
  const slice = getSlices(doc).find((s) => s.id === sliceId);
  if (!slice)
    return null;
  return pacing.policy === "slice" ? slice.id : slice.wave ?? 0;
}
function resolvedUnits(doc) {
  const pacing = getPacing(doc);
  if (!pacing)
    return 0;
  const slices = getSlices(doc);
  const { exempt_kinds: exemptKinds = [], policy, offset = 0 } = pacing;
  let raw;
  if (policy === "slice") {
    raw = slices.filter((s) => !isExemptSlice(s, exemptKinds) && s.status === "complete").length;
  } else if (policy === "wave" || policy === "milestone") {
    const waves = new Map;
    for (const s of slices) {
      if (isExemptSlice(s, exemptKinds))
        continue;
      const w = s.wave ?? 0;
      const entry = waves.get(w) ?? { total: 0, complete: 0 };
      entry.total++;
      if (s.status === "complete")
        entry.complete++;
      waves.set(w, entry);
    }
    raw = 0;
    for (const { total, complete } of waves.values()) {
      if (total > 0 && complete === total)
        raw++;
    }
  } else {
    raw = 0;
  }
  return Math.max(0, raw - offset);
}
function inFlightUnit(doc) {
  const pacing = getPacing(doc);
  if (!pacing)
    return null;
  const slices = getSlices(doc);
  const { exempt_kinds: exemptKinds = [], policy } = pacing;
  const incomplete = slices.filter((s) => !isExemptSlice(s, exemptKinds) && s.status !== "complete");
  if (incomplete.length === 0)
    return null;
  if (policy === "slice") {
    return incomplete[0].id;
  }
  let minWave = Infinity;
  for (const s of incomplete) {
    const w = s.wave ?? 0;
    if (w < minWave)
      minWave = w;
  }
  return minWave === Infinity ? null : minWave;
}
function activeUnit(doc) {
  const pacing = getPacing(doc);
  if (!pacing)
    return null;
  const slices = getSlices(doc);
  const { exempt_kinds: exemptKinds = [], policy } = pacing;
  const active = slices.filter((s) => !isExemptSlice(s, exemptKinds) && s.status === "in_progress");
  if (active.length === 0)
    return null;
  if (policy === "slice") {
    return active[0].id;
  }
  let minWave = Infinity;
  for (const s of active) {
    const w = s.wave ?? 0;
    if (w < minWave)
      minWave = w;
  }
  return minWave === Infinity ? null : minWave;
}
function isExhausted(doc) {
  const pacing = getPacing(doc);
  if (!pacing)
    return false;
  if (activeUnit(doc) !== null)
    return false;
  const { budget = 1, grant } = pacing;
  const grantRange = grant?.range ?? 0;
  const cap = budget + grantRange;
  const slices = getSlices(doc);
  const { exempt_kinds: exemptKinds = [] } = pacing;
  const hasRemainingWork = slices.some((s) => !isExemptSlice(s, exemptKinds) && s.status !== "complete");
  return hasRemainingWork && resolvedUnits(doc) >= cap;
}
function checkPace(doc, sliceId, currentBuildHash) {
  const pacing = getPacing(doc);
  if (!pacing)
    return { allowed: true };
  const slices = getSlices(doc);
  const slice = slices.find((s) => s.id === sliceId);
  if (!slice)
    return { allowed: true };
  const { exempt_kinds: exemptKinds = [], budget = 1, grant, policy } = pacing;
  if (isExemptSlice(slice, exemptKinds))
    return { allowed: true };
  const targetUnit = resolveUnit(doc, sliceId);
  const currentActive = activeUnit(doc);
  if (currentActive !== null && targetUnit === currentActive) {
    return { allowed: true };
  }
  const grantRange = grant?.range ?? 0;
  const cap = budget + grantRange;
  const consumed = resolvedUnits(doc);
  if (consumed < cap) {
    return { allowed: true };
  }
  if (policy === "milestone") {
    const signoff = pacing.milestone_signoff;
    if (signoff?.verdict === "APPROVE") {
      const artCheck = checkMilestoneArtifacts(doc, currentBuildHash ?? null);
      if (!artCheck.satisfied) {
        const hashContext = currentBuildHash ? `(build hash changed since sign-off)` : `(no current build hash supplied \u2014 pass --build-hash <hash> to ledger claim)`;
        const staleReason = `Milestone gate: APPROVE sign-off is present but artifacts cannot be verified as fresh ` + `${hashContext}.
` + `${artCheck.reason}
` + `Re-capture these artifacts against the current build, then record a fresh sign-off.`;
        const staleRemedy = `1. Re-capture the stale artifacts (current build hash: ${currentBuildHash ?? "unknown"}).
` + `2. ledger milestone-signoff --verdict APPROVE --verified-by <name> ` + `--build-hash <current> --token <write_token>`;
        return { allowed: false, reason: staleReason, remedy: staleRemedy };
      }
      return { allowed: true };
    }
    const artifacts = Array.isArray(pacing.milestone_artifacts) ? pacing.milestone_artifacts : [];
    const artifactList = artifacts.length > 0 ? artifacts.map((a) => `  \u2022 ${a.label ?? a.path ?? "(unnamed)"} (${a.kind ?? "unknown"})`).join(`
`) : "  (no artifacts declared)";
    const milestoneReason = `Milestone gate: human sign-off required before opening wave ${targetUnit}.
` + `Declared artifacts:
${artifactList}
` + (signoff ? `Last verdict: ${signoff.verdict} (by ${signoff.verified_by}).` : "No sign-off recorded yet.");
    const milestoneRemedy = `Record a human-verified sign-off with:
` + `  ledger milestone-signoff --verdict APPROVE --verified-by <name> --token <write_token>`;
    return { allowed: false, reason: milestoneReason, remedy: milestoneRemedy };
  }
  const unitLabel = policy === "slice" ? `slice "${sliceId}"` : `wave ${targetUnit}`;
  const reason = `Pacing budget exhausted: ${consumed} of ${cap} unit${cap === 1 ? "" : "s"} consumed ` + `(budget=${budget}${grantRange > 0 ? `, grant.range=${grantRange}` : ""}). ` + `${unitLabel} would open a new unit but none remains for this session.`;
  const remedy = `Option A: ask the operator to authorize \`ledger autopilot --range N --reason "\u2026"\` \u2014 do not self-grant. ` + `Option B: run \`/groundwork:pause\` and continue in a new session.`;
  return { allowed: false, reason, remedy };
}
function checkMilestoneArtifacts(doc, currentBuildHash) {
  const pacing = getPacing(doc);
  if (!pacing)
    return { satisfied: true, staleArtifacts: [] };
  const artifacts = Array.isArray(pacing.milestone_artifacts) ? pacing.milestone_artifacts : [];
  if (artifacts.length === 0)
    return { satisfied: true, staleArtifacts: [] };
  const stale = [];
  let anyHashUnknown = false;
  let anyMissingHash = false;
  let anyUnknownKind = false;
  for (const artifact of artifacts) {
    const kind = artifact.kind ?? "";
    const pathLabel = artifact.path ?? "(unknown)";
    if (!KNOWN_ARTIFACT_KINDS.includes(kind)) {
      stale.push(pathLabel);
      anyUnknownKind = true;
      continue;
    }
    if (STALEABLE_ARTIFACT_KINDS.includes(kind) && !artifact.captured_build_hash) {
      stale.push(pathLabel);
      anyMissingHash = true;
      continue;
    }
    if (artifact.captured_build_hash) {
      if (!currentBuildHash) {
        stale.push(pathLabel);
        anyHashUnknown = true;
      } else if (artifact.captured_build_hash !== currentBuildHash) {
        stale.push(pathLabel);
      }
    }
  }
  const CAPTURED_KINDS = ["file", "run_output", "screenshot"];
  const hasLiveUrl = artifacts.some((a) => a.kind === "live_url");
  const hasCapturedCompanion = artifacts.some((a) => CAPTURED_KINDS.includes(a.kind ?? ""));
  let anyLiveUrlAlone = false;
  if (hasLiveUrl && !hasCapturedCompanion) {
    for (const artifact of artifacts) {
      if (artifact.kind === "live_url")
        stale.push(artifact.path ?? "(unknown)");
    }
    anyLiveUrlAlone = true;
  }
  const reason = stale.length > 0 ? anyLiveUrlAlone ? `live_url artifact requires a captured companion (file, run_output, or screenshot) in the same milestone \u2014 a URL alone is not a capture` : anyUnknownKind ? `Artifact with unknown kind rejected (fail-closed \u2014 must be one of: ${KNOWN_ARTIFACT_KINDS.join(", ")}): ${stale.join(", ")}` : anyMissingHash ? `screenshot and run_output artifacts require captured_build_hash \u2014 omitting the field is rejected (fail-closed): ${stale.join(", ")}` : anyHashUnknown ? `Stale artifacts (cannot verify freshness \u2014 no current build hash supplied; pass --build-hash to ledger claim): ${stale.join(", ")}` : `Stale artifacts (build hash mismatch \u2014 artifact captured before the current build): ${stale.join(", ")}` : undefined;
  return {
    satisfied: stale.length === 0,
    staleArtifacts: stale,
    ...reason != null ? { reason } : {}
  };
}

// hooks/lib/journal-io.mjs
import {
  closeSync as closeSync2,
  mkdirSync as mkdirSync3,
  openSync as openSync2,
  readdirSync as readdirSync2,
  readFileSync as readFileSync3,
  writeSync
} from "fs";
import path3 from "path";
var VALID_TYPES = [
  "DECISION",
  "SPEC_CHANGE",
  "LINT_DRIFT",
  "PROTOTYPE_RESULT",
  "FAILURE",
  "MILESTONE",
  "TASK_COMPLETE",
  "GATE",
  "VERIFICATION",
  "WAIVER",
  "HANDOFF",
  "PAUSE",
  "SESSION_START",
  "SPEC_DRIFT",
  "SESSION_END",
  "MOTIVE_CREATED",
  "BASELINE",
  "GRAPH_MUTATE",
  "AC_COVERAGE",
  "AC_RETRACTION"
];
var NEVER_COMPRESS = new Set(["DECISION", "SPEC_CHANGE", "MOTIVE_CREATED", "BASELINE", "AC_COVERAGE", "AC_RETRACTION"]);
function eventMotive(e) {
  return e.motive;
}
function resolveMotive({ projectDir, sessionId, ledger } = {}) {
  if (process.env.GROUNDWORK_MOTIVE) {
    return { motive: process.env.GROUNDWORK_MOTIVE, provenance: "env" };
  }
  let l = ledger;
  if (l === undefined) {
    const dir = projectDir ?? process.cwd();
    l = null;
    try {
      l = JSON.parse(readFileSync3(path3.join(dir, ".groundwork", "run.json"), "utf8"));
    } catch {
      l = null;
    }
    if (!l?.active) {
      let files = [];
      try {
        files = readdirSync2(path3.join(dir, ".groundwork", "runs"));
      } catch {}
      for (const f of files) {
        if (!f.endsWith(".json"))
          continue;
        try {
          const candidate = JSON.parse(readFileSync3(path3.join(dir, ".groundwork", "runs", f), "utf8"));
          if (candidate.active && (!sessionId || candidate.session_id === sessionId)) {
            l = candidate;
            break;
          }
        } catch {}
      }
    }
  }
  if (l?.motive)
    return { motive: l.motive, provenance: "ledger.motive" };
  if (l?.rfc_ref)
    return { motive: l.rfc_ref, provenance: "ledger.rfc_ref" };
  const sid = sessionId ?? "unknown";
  return { motive: `session:${sid}`, provenance: "synthetic" };
}
function emitHookEvent(opts = {}) {
  const {
    projectDir,
    sessionId,
    type,
    msg,
    source,
    data,
    ledger,
    date
  } = opts;
  try {
    if (!VALID_TYPES.includes(type)) {
      process.stderr.write(`journal: emitHookEvent: invalid type "${type}" \u2014 event not written
`);
      return { ok: false, error: `invalid type: ${type}` };
    }
    const { motive, provenance } = resolveMotive({ projectDir, sessionId, ledger });
    const ts = new Date().toISOString();
    const event = {
      ts,
      session: sessionId ?? "unknown",
      motive,
      type,
      msg,
      source
    };
    if (data !== undefined)
      event.data = { ...data, motive_provenance: provenance };
    const shardPath = resolveShardPath(projectDir ?? process.cwd(), sessionId ?? "unknown", date);
    appendEvent(shardPath, event);
    return { ok: true, motive, provenance };
  } catch (err) {
    process.stderr.write(`journal: emitHookEvent: failed to write event: ${err?.message ?? err}
`);
    return { ok: false, error: err?.message ?? String(err) };
  }
}
var SAFE_SESSION = /^[A-Za-z0-9_-]{1,128}$/;
function resolveShardPath(projectDir, sessionId, date) {
  const safeId = SAFE_SESSION.test(sessionId ?? "") ? sessionId : "default";
  const d = date ?? new Date().toISOString().slice(0, 10);
  return path3.join(projectDir, ".groundwork", "journal", `${d}-${safeId}.jsonl`);
}
function appendEvent(shardPath, event) {
  mkdirSync3(path3.dirname(shardPath), { recursive: true });
  const buf = Buffer.from(JSON.stringify(event) + `
`, "utf8");
  const fd = openSync2(shardPath, "a");
  try {
    writeSync(fd, buf);
  } finally {
    closeSync2(fd);
  }
}
function readAllEvents(journalDir) {
  let files;
  try {
    files = readdirSync2(journalDir).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return [];
  }
  const events = [];
  for (const f of files) {
    const fp = path3.join(journalDir, f);
    let text;
    try {
      text = readFileSync3(fp, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split(`
`)) {
      const trimmed = line.trim();
      if (!trimmed)
        continue;
      try {
        events.push(JSON.parse(trimmed));
      } catch {}
    }
  }
  events.sort((a, b) => {
    const ta = a.ts ?? "";
    const tb = b.ts ?? "";
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });
  return events;
}
function filterEvents(events, { motive, type, since, last } = {}) {
  let filtered = events;
  if (motive != null) {
    filtered = filtered.filter((e) => eventMotive(e) === motive);
  }
  if (type != null) {
    const types = new Set(type.split(",").map((t) => t.trim()).filter(Boolean));
    filtered = filtered.filter((e) => types.has(e.type));
  }
  if (since != null) {
    const sinceDate = parseSince(since);
    if (sinceDate) {
      filtered = filtered.filter((e) => e.ts && new Date(e.ts) >= sinceDate);
    }
  }
  const total = filtered.length;
  const n = last != null ? Math.max(0, last) : total;
  const shown = filtered.slice(-n);
  const withheld = total - shown.length;
  return { shown, withheld, total };
}
function parseSince(since) {
  if (!since)
    return null;
  const rel = /^(\d+)d$/i.exec(since);
  if (rel) {
    const d2 = new Date;
    d2.setUTCDate(d2.getUTCDate() - parseInt(rel[1], 10));
    d2.setUTCHours(0, 0, 0, 0);
    return d2;
  }
  const d = new Date(since);
  return isNaN(d.getTime()) ? null : d;
}

// hooks/ledger.mjs
init_schema_io();

// hooks/lib/motive-map.mjs
import { readFileSync as readFileSync7, writeFileSync as writeFileSync4, readdirSync as readdirSync5, existsSync as existsSync4 } from "fs";
import { join as join2 } from "path";

// hooks/lib/motive-charter.mjs
import path4 from "path";
import fs from "fs";
function charterPath(projectDir, motive) {
  return path4.join(projectDir, ".groundwork", "motives", motive, "motive.md");
}
var SECTION_RE = /^(#{1,6})\s+(.+)$/;
var OPEN_ITEM_RE = /^-\s+((?:TBD|TBR)-\S+):\s+(.+)$/i;
var AC_ITEM_RE = /^-\s+(AC-\S+):\s+(.+)$/;
var AC_ITEM_RE_CI = /^-\s+(AC-\S+):\s+(.+)$/i;
var OWNER_RE = /@(\S+)/;
var BLOCKED_BY_RE = /\bblocked-by:(\S+)/i;
var GRADUATED_TO_RE = /\bgraduated-to:\s*(\S+)/i;
function parseOpenItems(body) {
  const stripped = body.replace(/<!--[\s\S]*?-->/g, "");
  const items = [];
  let malformedCount = 0;
  for (const line of stripped.split(`
`)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("-")) {
      if (trimmed && items.length > 0) {
        const current = items[items.length - 1];
        if (current._bodyLines === undefined)
          current._bodyLines = [];
        current._bodyLines.push(trimmed);
      }
      continue;
    }
    const m = OPEN_ITEM_RE.exec(trimmed);
    if (!m) {
      malformedCount++;
      continue;
    }
    const id = m[1];
    const kind = id.slice(0, 3).toUpperCase();
    let remainder = m[2].trim();
    const ownerM = OWNER_RE.exec(remainder);
    const owner = ownerM ? ownerM[1] : undefined;
    const blockedByM = BLOCKED_BY_RE.exec(remainder);
    const blocked_by = blockedByM ? blockedByM[1] : undefined;
    const graduatedToM = GRADUATED_TO_RE.exec(remainder);
    const graduated_to = graduatedToM ? graduatedToM[1] : undefined;
    let statement = remainder.replace(OWNER_RE, "").replace(BLOCKED_BY_RE, "").replace(GRADUATED_TO_RE, "").trim().replace(/\s{2,}/g, " ");
    const item = { id, kind, statement };
    if (owner)
      item.owner = owner;
    if (blocked_by)
      item.blocked_by = blocked_by;
    if (graduated_to)
      item.graduated_to = graduated_to;
    items.push(item);
  }
  for (const item of items) {
    if (item._bodyLines !== undefined) {
      item.body = item._bodyLines.join(`
`);
      delete item._bodyLines;
    }
    if (!item.graduated_to && item.body) {
      const bodyGraduatedToM = GRADUATED_TO_RE.exec(item.body);
      if (bodyGraduatedToM)
        item.graduated_to = bodyGraduatedToM[1];
    }
  }
  const openItems = items.filter((item) => !item.statement.startsWith("~~"));
  return { items: openItems, malformedCount };
}
function parseAcceptanceCriteria(body) {
  if (!body)
    return { items: [], caseMismatchLines: [] };
  const stripped = body.replace(/<!--[\s\S]*?-->/g, "");
  const items = [];
  const caseMismatchLines = [];
  for (const line of stripped.split(`
`)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("-")) {
      if (trimmed && items.length > 0) {
        items[items.length - 1].statement += " " + trimmed;
      }
      continue;
    }
    const m = AC_ITEM_RE.exec(trimmed);
    if (!m) {
      if (AC_ITEM_RE_CI.test(trimmed)) {
        caseMismatchLines.push(trimmed);
      }
      continue;
    }
    items.push({ id: m[1], statement: m[2].trim() });
  }
  return { items, caseMismatchLines };
}
function splitSections(src) {
  const sections = new Map;
  let currentKey = null;
  let sectionLevel = 0;
  const bodyLines = [];
  for (const line of src.split(`
`)) {
    const m = SECTION_RE.exec(line);
    if (m) {
      const level = m[1].length;
      const title = m[2].trim().toLowerCase();
      if (sectionLevel === 0) {
        if (currentKey === null) {
          currentKey = title;
          bodyLines.length = 0;
        } else {
          sectionLevel = level;
          sections.set(currentKey, bodyLines.join(`
`).trim());
          currentKey = title;
          bodyLines.length = 0;
        }
      } else if (level <= sectionLevel) {
        if (currentKey != null) {
          sections.set(currentKey, bodyLines.join(`
`).trim());
        }
        currentKey = title;
        bodyLines.length = 0;
      } else {
        bodyLines.push(line);
      }
    } else {
      bodyLines.push(line);
    }
  }
  if (currentKey != null) {
    sections.set(currentKey, bodyLines.join(`
`).trim());
  }
  return sections;
}
function _parseCharterDecisions(body) {
  if (!body)
    return [];
  const DECISION_RE = /^DECISION\s+(\S+?):\s*(.*)$/i;
  const items = [];
  for (const line of body.split(`
`)) {
    const trimmed = line.trim();
    const m = DECISION_RE.exec(trimmed);
    if (m) {
      items.push({ id: m[1], text: m[2].trim() });
    } else if (trimmed && items.length > 0) {
      items[items.length - 1].text += " " + trimmed;
    }
  }
  return items;
}
function readCharter({ projectDir, motive }) {
  const filePath = charterPath(projectDir, motive);
  let src;
  try {
    src = fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
  try {
    const sections = splitSections(src);
    const objective = sections.get("objective") ?? "";
    const notes = sections.get("notes") ?? "";
    const out_of_scope = sections.get("out of scope") ?? "";
    const openItemsBody = sections.get("open items") ?? "";
    const decisionsBody = sections.get("decisions") ?? "";
    const acBody = sections.get("acceptance criteria") ?? "";
    const { items: open_items, malformedCount } = parseOpenItems(openItemsBody);
    if (malformedCount > 0) {
      process.stderr.write(`[motive-charter] ${malformedCount} malformed open-item line(s) in ${filePath} \u2014 skipped
`);
    }
    const decisions = _parseCharterDecisions(decisionsBody);
    const { items: acceptance_criteria, caseMismatchLines } = parseAcceptanceCriteria(acBody);
    for (const line of caseMismatchLines) {
      process.stderr.write(`[motive-charter] warn: AC id must start with uppercase "AC-" \u2014 line skipped: "${line}" in ${filePath}
`);
    }
    return {
      objective,
      open_items,
      notes,
      out_of_scope,
      decisions,
      acceptance_criteria,
      path: filePath
    };
  } catch {
    return null;
  }
}

// hooks/lib/journal-order.mjs
import { readdirSync as readdirSync3, readFileSync as readFileSync5 } from "fs";
import path5 from "path";
function eventMotive2(e) {
  return e.motive;
}
function compareEvents(a, b) {
  const ta = a._order._ts ?? "";
  const tb = b._order._ts ?? "";
  if (ta < tb)
    return -1;
  if (ta > tb)
    return 1;
  const sa = a._order.shard;
  const sb = b._order.shard;
  if (sa < sb)
    return -1;
  if (sa > sb)
    return 1;
  return a._order.line - b._order.line;
}
function readOrderedEvents(journalDir, { motive } = {}) {
  let shardFiles;
  try {
    shardFiles = readdirSync3(journalDir).filter((f) => f.endsWith(".jsonl")).sort();
  } catch {
    return { events: [], malformed_lines: 0 };
  }
  const tagged = [];
  let malformed_lines = 0;
  for (const shard of shardFiles) {
    const fp = path5.join(journalDir, shard);
    let text;
    try {
      text = readFileSync5(fp, "utf8");
    } catch {
      continue;
    }
    const rawLines = text.split(`
`);
    for (let lineIdx = 0;lineIdx < rawLines.length; lineIdx++) {
      const raw = rawLines[lineIdx];
      const trimmed = raw.trim();
      if (!trimmed)
        continue;
      let evt;
      try {
        evt = JSON.parse(trimmed);
      } catch {
        malformed_lines++;
        continue;
      }
      evt._order = { shard, line: lineIdx, _ts: evt.ts ?? "" };
      tagged.push(evt);
    }
  }
  tagged.sort(compareEvents);
  const filtered = motive != null ? tagged.filter((e) => eventMotive2(e) === motive) : tagged;
  for (let i = 0;i < filtered.length; i++) {
    filtered[i].ord = i + 1;
  }
  for (const e of filtered) {
    const { shard, line } = e._order;
    e._order = { shard, line };
  }
  return { events: filtered, malformed_lines };
}

// hooks/lib/motive-graph-project.mjs
var NON_RECONSTRUCTIBLE_FIELDS = Object.freeze({
  "decision_log[].slices": "Requires ledger ground truth; empty on both sides without groundTruth",
  "baselines[].line": "Shard line offset not stored in fold"
});
// hooks/lib/motive-graph.mjs
var EDGE_KINDS = {
  anchors: { drives_layering: true, render: "primary", direction: "down" },
  resolved_by: { drives_layering: false, render: "muted", direction: "lateral" },
  graduated_to: { drives_layering: false, render: "muted", direction: "lateral" },
  blocked_by: { drives_layering: true, render: "primary", direction: "up" },
  covers_ac: { drives_layering: true, render: "primary", direction: "down" },
  slice_decision: { drives_layering: true, render: "hidden", direction: "up" },
  spec_xref: { drives_layering: false, render: "muted", direction: "lateral" },
  supersedes: { drives_layering: false, render: "muted", direction: "lateral" },
  retires: { drives_layering: false, render: "muted", direction: "lateral" },
  revises: { drives_layering: false, render: "muted", direction: "lateral" }
};

// hooks/lib/motive-graph-fold.mjs
var SCHEMA_VERSION2 = 1;

class AllFieldsSet extends Set {
  has(_field) {
    return true;
  }
}
var NODE_KINDS = Object.freeze(new Set([
  "objective",
  "decision",
  "open-item",
  "ticket",
  "acceptance-criterion",
  "slice",
  "spec-requirement",
  "baseline"
]));
var CONSUMED_FIELDS = Object.freeze({
  MOTIVE_CREATED: Object.freeze(new Set(["objective"])),
  DECISION: Object.freeze(new Set([
    "id",
    "title",
    "status",
    "summary",
    "rationale",
    "source",
    "alternatives",
    "blast",
    "gaps",
    "relates_to",
    "resolves",
    "retires",
    "revises",
    "refs",
    "research",
    "supersedes",
    "items_registered",
    "decision",
    "motive_provenance",
    "ord",
    "ts"
  ])),
  BASELINE: Object.freeze(new Set(["name", "shard", "ord", "ts"])),
  AC_COVERAGE: Object.freeze(new Set(["ac", "slice", "covering", "motive_provenance"])),
  AC_RETRACTION: Object.freeze(new Set(["ac", "slice", "reason", "motive_provenance"])),
  GATE: Object.freeze(new AllFieldsSet),
  MILESTONE: Object.freeze(new AllFieldsSet),
  TASK_COMPLETE: Object.freeze(new AllFieldsSet),
  SESSION_END: Object.freeze(new AllFieldsSet),
  VERIFICATION: Object.freeze(new AllFieldsSet),
  PAUSE: Object.freeze(new AllFieldsSet),
  SESSION_START: Object.freeze(new AllFieldsSet),
  SPEC_CHANGE: Object.freeze(new AllFieldsSet),
  LINT_DRIFT: Object.freeze(new AllFieldsSet),
  PROTOTYPE_RESULT: Object.freeze(new AllFieldsSet),
  FAILURE: Object.freeze(new AllFieldsSet),
  WAIVER: Object.freeze(new AllFieldsSet),
  HANDOFF: Object.freeze(new AllFieldsSet),
  SPEC_DRIFT: Object.freeze(new AllFieldsSet),
  GRAPH_MUTATE: Object.freeze(new AllFieldsSet)
});
function assembleGraphFold(orderedEvents, { at, charter: _charter, groundTruth: _groundTruth } = {}) {
  const nodesMap = new Map;
  const edgesArr = [];
  const attrs = {
    gates: [],
    milestones: [],
    sessions: [],
    verifications: [],
    pauses: [],
    session_starts: [],
    spec_changes: [],
    lint_drifts: [],
    prototype_results: [],
    failures: [],
    waivers: [],
    handoffs: [],
    spec_drifts: [],
    ac_retractions: []
  };
  const motive = orderedEvents.length > 0 ? orderedEvents[0].motive ?? "" : "";
  function nodeAssert(kind, id, nodeAttrs) {
    if (!NODE_KINDS.has(kind)) {
      throw new TypeError(`assembleGraphFold: unknown node kind "${kind}"`);
    }
    const existing = nodesMap.get(id);
    if (existing) {
      Object.assign(existing.attrs, nodeAttrs);
    } else {
      nodesMap.set(id, { id, type: kind, attrs: { ...nodeAttrs } });
    }
  }
  function nodeRetire(id, by) {
    const n = nodesMap.get(id);
    if (n) {
      n.retired = true;
      n.attrs._retired_by = by;
    }
  }
  function edgeAssert(kind, from, to) {
    if (!EDGE_KINDS[kind]) {
      throw new TypeError(`assembleGraphFold: unknown edge kind "${kind}"`);
    }
    const dup = edgesArr.some((e) => e.kind === kind && e.from === from && e.to === to && !e.retired);
    if (!dup)
      edgesArr.push({ kind, from, to });
  }
  function edgeRetire(kind, from, to) {
    const e = edgesArr.find((e2) => e2.kind === kind && e2.from === from && e2.to === to && !e2.retired);
    if (e)
      e.retired = true;
  }
  function attrSet(nodeId, key, value) {
    const n = nodesMap.get(nodeId);
    if (n)
      n.attrs[key] = value;
  }
  function handleMotiveCreated(data, _event) {
    const { objective } = data;
    nodeAssert("objective", "objective:root", { objective });
  }
  function handleDecision(data, event) {
    const {
      id,
      title,
      status,
      summary,
      rationale,
      source,
      alternatives,
      blast,
      gaps,
      relates_to,
      resolves,
      retires,
      revises,
      refs,
      research,
      supersedes,
      items_registered,
      decision,
      motive_provenance: _mp
    } = data;
    const nodeId = id ? `decision:${id}` : `decision:_legacy_ord${event.ord ?? event.ts}`;
    const candidates = {
      id,
      title,
      status,
      summary,
      rationale,
      source,
      alternatives,
      blast,
      gaps,
      relates_to,
      resolves,
      retires,
      revises,
      refs,
      research,
      supersedes,
      items_registered,
      decision
    };
    const nodeAttrs = {};
    for (const [k, v] of Object.entries(candidates)) {
      if (v != null)
        nodeAttrs[k] = v;
    }
    if (!nodesMap.has(nodeId)) {
      if (event.ord != null)
        nodeAttrs._ord = event.ord;
      if (event.ts != null)
        nodeAttrs._ts = event.ts;
    }
    nodeAssert("decision", nodeId, nodeAttrs);
    if (nodesMap.has("objective:root")) {
      edgeAssert("anchors", "objective:root", nodeId);
    }
    function emitLifecycleEdge(kind, targetRaw) {
      if (!targetRaw || typeof targetRaw !== "string" || /\s/.test(targetRaw))
        return;
      edgeAssert(kind, nodeId, `decision:${targetRaw}`);
    }
    if (supersedes)
      emitLifecycleEdge("supersedes", supersedes);
    if (retires)
      emitLifecycleEdge("retires", retires);
    if (revises)
      emitLifecycleEdge("revises", revises);
  }
  function handleBaseline(data, event) {
    const { name, shard } = data;
    const nodeId = name != null ? `baseline:${name}` : `baseline:@${event.ord ?? event.ts}`;
    const baseAttrs = { name, shard };
    if (!nodesMap.has(nodeId)) {
      if (event.ord != null)
        baseAttrs._ord = event.ord;
      if (event.ts != null)
        baseAttrs._ts = event.ts;
    }
    nodeAssert("baseline", nodeId, baseAttrs);
  }
  function handleGate(data, event) {
    attrs.gates.push({ ts: event.ts, ...data });
  }
  function handleMilestone(data, event) {
    attrs.milestones.push({ ts: event.ts, ...data });
  }
  function handleAcCoverage(data, _event) {
    const { ac, slice, covering, motive_provenance: _mp } = data;
    if (ac && slice) {
      const acId = `ac:${ac}`;
      const sliceId = `slice:${slice}`;
      if (!nodesMap.has(acId))
        nodeAssert("acceptance-criterion", acId, { ac });
      if (!nodesMap.has(sliceId))
        nodeAssert("slice", sliceId, { slice });
      edgeAssert("covers_ac", sliceId, acId);
    } else if (ac && Array.isArray(covering)) {
      const acId = `ac:${ac}`;
      if (!nodesMap.has(acId))
        nodeAssert("acceptance-criterion", acId, { ac, covering });
    }
  }
  function handleAcRetraction(data, event) {
    const { ac, slice, reason, motive_provenance: _mp } = data;
    if (ac && slice) {
      edgeRetire("covers_ac", `slice:${slice}`, `ac:${ac}`);
    }
    attrs.ac_retractions.push({ ts: event.ts, ac, slice, reason });
  }
  function handleTaskComplete(data, event) {
    const { slice, slice_id, motive_provenance: _mp, ...rest } = data;
    const sliceKey = slice_id ?? slice;
    if (sliceKey) {
      nodeAssert("slice", `slice:${sliceKey}`, {
        ...rest,
        slice,
        slice_id,
        _completed_at: event.ts
      });
    }
  }
  function handleSessionEnd(data, event) {
    attrs.sessions.push({ ts: event.ts, session: event.session, ...data });
  }
  function handleVerification(data, event) {
    attrs.verifications.push({ ts: event.ts, ...data });
  }
  function handlePause(data, event) {
    attrs.pauses.push({ ts: event.ts, ...data });
  }
  function handleSessionStart(data, event) {
    attrs.session_starts.push({ ts: event.ts, ...data });
  }
  function handleSpecChange(data, event) {
    attrs.spec_changes.push({ ts: event.ts, ...data });
  }
  function handleLintDrift(data, event) {
    attrs.lint_drifts.push({ ts: event.ts, ...data });
  }
  function handlePrototypeResult(data, event) {
    attrs.prototype_results.push({ ts: event.ts, ...data });
  }
  function handleFailure(data, event) {
    attrs.failures.push({ ts: event.ts, ...data });
  }
  function handleWaiver(data, event) {
    attrs.waivers.push({ ts: event.ts, ...data });
  }
  function handleHandoff(data, event) {
    attrs.handoffs.push({ ts: event.ts, ...data });
  }
  function handleSpecDrift(data, event) {
    attrs.spec_drifts.push({ ts: event.ts, ...data });
  }
  function handleGraphMutate(data, _event) {
    switch (data.op) {
      case "node.assert":
        nodeAssert(data.kind, data.id, data.attrs ?? {});
        break;
      case "node.retire":
        nodeRetire(data.id, data.by);
        break;
      case "edge.assert":
        edgeAssert(data.kind, data.from, data.to);
        break;
      case "edge.retire":
        edgeRetire(data.kind, data.from, data.to);
        break;
      case "attr.set":
        attrSet(data.nodeId, data.key, data.value);
        break;
    }
  }
  const HANDLERS = {
    MOTIVE_CREATED: handleMotiveCreated,
    DECISION: handleDecision,
    BASELINE: handleBaseline,
    GATE: handleGate,
    MILESTONE: handleMilestone,
    AC_COVERAGE: handleAcCoverage,
    AC_RETRACTION: handleAcRetraction,
    TASK_COMPLETE: handleTaskComplete,
    SESSION_END: handleSessionEnd,
    VERIFICATION: handleVerification,
    SPEC_CHANGE: handleSpecChange,
    LINT_DRIFT: handleLintDrift,
    PROTOTYPE_RESULT: handlePrototypeResult,
    FAILURE: handleFailure,
    WAIVER: handleWaiver,
    HANDOFF: handleHandoff,
    PAUSE: handlePause,
    SESSION_START: handleSessionStart,
    SPEC_DRIFT: handleSpecDrift,
    GRAPH_MUTATE: handleGraphMutate
  };
  for (const event of orderedEvents) {
    if (at != null && event.ts > at)
      continue;
    const handler = HANDLERS[event.type];
    if (handler) {
      handler(event.data ?? {}, event);
    }
  }
  const nodes = Array.from(nodesMap.values()).filter((n) => !n.retired);
  const edges = edgesArr.filter((e) => !e.retired);
  return {
    schema_version: SCHEMA_VERSION2,
    motive,
    nodes,
    edges,
    attrs
  };
}
// hooks/lib/motive-dag.mjs
function validateFoldRefs(fold, refIds, nodeType) {
  const resolvedType = nodeType === "ac" ? "acceptance-criterion" : nodeType;
  const presentIds = new Set(fold.nodes.filter((n) => n.type === resolvedType).map((n) => n.id));
  const valid = [];
  const missing = [];
  for (const id of refIds) {
    (presentIds.has(id) ? valid : missing).push(id);
  }
  return { valid, missing };
}

// hooks/lib/motive-tickets.mjs
import {
  writeFileSync as writeFileSync3,
  readFileSync as readFileSync6,
  readdirSync as readdirSync4,
  mkdirSync as mkdirSync4,
  rmSync,
  existsSync as existsSync3
} from "fs";
import { join } from "path";
function regenerateMotiveTickets(motiveDir, { slices = [], openItems = [], events = [] }) {
  try {
    _regenerate(motiveDir, { slices, openItems, events });
  } catch (err) {
    process.stderr.write(`[motive-tickets] warn: failed to regenerate tickets: ${err?.message ?? err}
`);
  }
}
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function sanitizeId(id) {
  if (!id || typeof id !== "string")
    return null;
  if (id.includes("/") || id.includes(".."))
    return null;
  return id.toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-{2,}/g, "-").replace(/^-|-$/g, "") || null;
}
function _regenerate(motiveDir, { openItems, events }) {
  const openItemsDir = join(motiveDir, "open-items");
  mkdirSync4(openItemsDir, { recursive: true });
  const expected = new Map;
  const seenStems = new Map;
  for (const item of openItems) {
    if (item.resolved_by)
      continue;
    const safeName = sanitizeId(item.id);
    if (!safeName)
      continue;
    if (seenStems.has(safeName)) {
      process.stderr.write(`[motive-tickets] warn: id collision: "${item.id}" and "${seenStems.get(safeName)}" both sanitize to "${safeName}" \u2014 overwriting
`);
    } else {
      seenStems.set(safeName, item.id);
    }
    const wordBoundary = new RegExp(`\\b${escapeRegExp(item.id)}\\b`);
    const relatedDecisions = events.filter((ev) => ev.type === "DECISION" && (ev.data?.tbd === item.id || ev.data?.resolves === item.id || wordBoundary.test(ev.msg ?? "")));
    expected.set(safeName, _renderOpenItemTicket(item, relatedDecisions));
  }
  for (const [safeName, content] of expected) {
    writeFileSync3(join(openItemsDir, `${safeName}.md`), content, "utf8");
  }
  if (existsSync3(openItemsDir)) {
    for (const f of readdirSync4(openItemsDir)) {
      if (!f.endsWith(".md"))
        continue;
      const stem = f.slice(0, -3);
      if (!expected.has(stem)) {
        try {
          rmSync(join(openItemsDir, f));
        } catch {}
      }
    }
  }
}
function _renderOpenItemTicket(item, relatedDecisions) {
  const parts = [];
  const statement = (item.statement ?? "").replace(/\s*\n\s*/g, " ").trim() || "(no statement)";
  parts.push(`# ${item.id}: ${statement}`);
  parts.push("");
  const body = (item.body ?? "").trim();
  if (body) {
    parts.push(body);
    parts.push("");
  }
  parts.push("## Status");
  parts.push("");
  const status = item.resolved_by ? "resolved" : "open";
  parts.push(`**${status}**`);
  parts.push("");
  parts.push("## Details");
  parts.push("");
  if (item.kind)
    parts.push(`**Kind:** ${item.kind}`);
  if (item.owner)
    parts.push(`**Owner:** @${item.owner}`);
  if (item.blocked_by)
    parts.push(`**Blocked by:** ${item.blocked_by}`);
  if (item.resolved_by)
    parts.push(`**Resolved by:** ${item.resolved_by}`);
  if (item.graduated_to) {
    parts.push(`**Graduated to:** [tickets/${item.graduated_to}.md](../tickets/${item.graduated_to}.md)`);
  }
  parts.push("");
  if (relatedDecisions.length) {
    parts.push("## Related decisions");
    parts.push("");
    for (const d of relatedDecisions) {
      const ts = (d.ts ?? "").slice(0, 10);
      const msg = d.msg ?? JSON.stringify(d.data ?? "");
      parts.push(`- ${ts ? `[${ts}] ` : ""}${msg}`);
    }
    parts.push("");
  }
  parts.push("---");
  parts.push("_Auto-generated \u2014 do not edit by hand._");
  return parts.join(`
`) + `
`;
}

// hooks/lib/dag-utils.mjs
function blockers(s) {
  return Array.isArray(s.blocked_by) ? s.blocked_by : [];
}
function topoLayers(slices) {
  if (!Array.isArray(slices) || slices.length === 0)
    return [];
  const idSet = new Set(slices.map((s) => s.id));
  const inDegree = new Map(slices.map((s) => [s.id, 0]));
  const successors = new Map(slices.map((s) => [s.id, []]));
  for (const s of slices) {
    for (const bId of blockers(s)) {
      if (!idSet.has(bId))
        continue;
      const prevDeg = inDegree.get(s.id) ?? 0;
      inDegree.set(s.id, prevDeg + 1);
      const sucList = successors.get(bId);
      if (sucList)
        sucList.push(s.id);
    }
  }
  const layers = [];
  let queue = [...inDegree.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  while (queue.length > 0) {
    layers.push([...queue]);
    const next = [];
    for (const id of queue) {
      const sucList = successors.get(id) ?? [];
      for (const childId of sucList) {
        const newDeg = (inDegree.get(childId) ?? 0) - 1;
        inDegree.set(childId, newDeg);
        if (newDeg === 0)
          next.push(childId);
      }
    }
    queue = next;
  }
  return layers;
}
function frontier(slices) {
  if (!Array.isArray(slices))
    return [];
  const completeIds = new Set(slices.filter((s) => s?.status === "complete").map((s) => s.id));
  return slices.filter((s) => {
    if (!s)
      return false;
    const status = s.status ?? "pending";
    if (status !== "pending")
      return false;
    if (s.kind === "fog")
      return false;
    return blockers(s).every((dep) => completeIds.has(dep));
  });
}
function transitiveBlockers(slices, id) {
  if (!Array.isArray(slices))
    return [];
  const sliceMap = new Map(slices.map((s) => [s.id, s]));
  const result = new Set;
  const stack = [id];
  while (stack.length > 0) {
    const current = stack.pop();
    const s = sliceMap.get(current);
    for (const bId of s ? blockers(s) : []) {
      if (!result.has(bId)) {
        result.add(bId);
        stack.push(bId);
      }
    }
  }
  return [...result];
}
function hasCycle(slices) {
  if (!Array.isArray(slices) || slices.length === 0)
    return false;
  const layers = topoLayers(slices);
  const assigned = new Set(layers.flat());
  return slices.some((s) => !assigned.has(s.id));
}

// hooks/lib/motive-map.mjs
function regenerateMotiveMap(projectDir, motive) {
  if (!projectDir || !motive)
    return;
  try {
    _generate(projectDir, motive);
  } catch (err) {
    process.stderr.write(`[motive-map] warn: failed to regenerate MAP.md for "${motive}": ${err?.message ?? err}
`);
  }
}
function _generate(projectDir, motive) {
  const motiveDir = join2(projectDir, ".groundwork", "motives", motive);
  if (!existsSync4(motiveDir))
    return;
  const charter = readCharter({ projectDir, motive });
  const ledgerDoc = _readMotiveLedgerDoc(projectDir, motive);
  const slices = Array.isArray(ledgerDoc?.slices) ? ledgerDoc.slices.filter(Boolean) : [];
  const acSlices = _readAllMotiveSlicesForAC(projectDir, motive);
  const USE_LEGACY_DECISIONS = process.env.GROUNDWORK_MAP_LEGACY_DECISIONS === "1";
  const journalDecisions = USE_LEGACY_DECISIONS ? _readDecisions(projectDir, motive) : _readDecisionsFromFold(projectDir, motive);
  const decisions = journalDecisions.length > 0 ? journalDecisions : (charter?.decisions ?? []).map((d) => ({ msg: `${d.id}: ${d.text}` }));
  const outOfScope = _readOutOfScope(projectDir);
  const rejectionDecisions = _readRejectionDecisions(projectDir, motive);
  const allEvents = _readAllMotiveEvents(projectDir, motive);
  if (charter?.open_items?.length) {
    const resolvedByDecisions = new Map;
    for (const ev of allEvents) {
      if (ev.type === "DECISION" && ev.data?.status === "accepted" && ev.data?.resolves != null) {
        if (!resolvedByDecisions.has(ev.data.resolves)) {
          resolvedByDecisions.set(ev.data.resolves, ev.data.id ?? ev.data.resolves);
        }
      }
    }
    for (const item of charter.open_items) {
      if (item.resolved_by == null) {
        const resolvedBy = resolvedByDecisions.get(item.id);
        if (resolvedBy != null)
          item.resolved_by = resolvedBy;
      }
    }
  }
  regenerateMotiveTickets(motiveDir, {
    slices,
    openItems: charter?.open_items ?? [],
    events: allEvents
  });
  const ticketFiles = _readTicketFiles(motiveDir);
  const lastPauseEvent = allEvents.find((ev) => ev.type === "PAUSE") ?? null;
  const lastPause = lastPauseEvent != null ? {
    pointer: lastPauseEvent.data?.pointer ?? null,
    summary: lastPauseEvent.data?.summary ?? null,
    next_actions: Array.isArray(lastPauseEvent.data?.next_actions) ? lastPauseEvent.data.next_actions : []
  } : null;
  const journalAcCoverage = _buildJournalAcCoverage(allEvents);
  const acRetractions = _buildAcRetractions(allEvents);
  const md = _renderMap({ motive, charter, slices, ledgerDoc, decisions, outOfScope, rejectionDecisions, ticketFiles, acSlices, journalAcCoverage, acRetractions, lastPause });
  writeFileSync4(join2(motiveDir, "MAP.md"), md, "utf8");
}
function _readMotiveLedgerDoc(projectDir, motive) {
  const candidates = [];
  const runsDir = join2(projectDir, ".groundwork", "runs");
  if (existsSync4(runsDir)) {
    for (const f of readdirSync5(runsDir)) {
      if (!f.endsWith(".json"))
        continue;
      try {
        const data = JSON.parse(readFileSync7(join2(runsDir, f), "utf8"));
        if (data.motive === motive)
          candidates.push(data);
      } catch {}
    }
  }
  const legacyPath = join2(projectDir, ".groundwork", "run.json");
  if (existsSync4(legacyPath)) {
    try {
      const data = JSON.parse(readFileSync7(legacyPath, "utf8"));
      if (data.motive === motive)
        candidates.push(data);
    } catch {}
  }
  if (!candidates.length)
    return null;
  return candidates.find((c) => c.active) ?? candidates[candidates.length - 1];
}
function _readAllMotiveSlicesForAC(projectDir, motive) {
  const sliceMap = new Map;
  const runsDir = join2(projectDir, ".groundwork", "runs");
  if (existsSync4(runsDir)) {
    for (const f of readdirSync5(runsDir)) {
      if (!f.endsWith(".json"))
        continue;
      try {
        const data = JSON.parse(readFileSync7(join2(runsDir, f), "utf8"));
        if (data.motive !== motive)
          continue;
        const sessionId = typeof data.session_id === "string" ? data.session_id : "";
        for (const s of Array.isArray(data.slices) ? data.slices : []) {
          if (!s || s.id == null)
            continue;
          const key = `${sessionId}::${s.id}`;
          if (!sliceMap.has(key)) {
            sliceMap.set(key, { ...s, _session_id: sessionId });
          }
        }
      } catch {}
    }
  }
  const legacyPath = join2(projectDir, ".groundwork", "run.json");
  if (existsSync4(legacyPath)) {
    try {
      const data = JSON.parse(readFileSync7(legacyPath, "utf8"));
      if (data.motive === motive) {
        const sessionId = typeof data.session_id === "string" ? data.session_id : "";
        for (const s of Array.isArray(data.slices) ? data.slices : []) {
          if (!s || s.id == null)
            continue;
          const key = `${sessionId}::${s.id}`;
          if (!sliceMap.has(key)) {
            sliceMap.set(key, { ...s, _session_id: sessionId });
          }
        }
      }
    } catch {}
  }
  return [...sliceMap.values()].filter(Boolean);
}
var TICKET_TYPE_ORDER = ["research", "choose", "model", "build", "grill", "spec", "fix", "chore"];
function _readTicketFiles(motiveDir) {
  const ticketsDir = join2(motiveDir, "tickets");
  if (!existsSync4(ticketsDir))
    return [];
  try {
    return readdirSync5(ticketsDir).filter((f) => f.endsWith(".md")).sort().map((f) => {
      const stem = f.slice(0, -3);
      let type = "other";
      try {
        const content = readFileSync7(join2(ticketsDir, f), "utf8");
        const m = /^Type:\s*(.+)$/m.exec(content);
        if (m)
          type = m[1].trim().toLowerCase();
      } catch {}
      return { stem, type };
    });
  } catch {
    return [];
  }
}
function _readDecisionsFromFold(projectDir, motive) {
  const journalDir = join2(projectDir, ".groundwork", "journal");
  if (!existsSync4(journalDir))
    return [];
  try {
    const { events: orderedEvents } = readOrderedEvents(journalDir, { motive });
    const msgMap = new Map;
    const idsFirstOrd = new Map;
    for (const ev of orderedEvents) {
      if (ev.type !== "DECISION")
        continue;
      const decId = ev.data?.id ?? null;
      if (decId) {
        if (!idsFirstOrd.has(decId))
          idsFirstOrd.set(decId, ev.ord);
        msgMap.set(idsFirstOrd.get(decId), ev.msg ?? null);
      } else {
        if (!msgMap.has(ev.ord))
          msgMap.set(ev.ord, ev.msg ?? null);
      }
    }
    const fold = assembleGraphFold(orderedEvents);
    const decisionNodes = fold.nodes.filter((n) => n.type === "decision").sort((a, b) => (b.attrs._ord ?? 0) - (a.attrs._ord ?? 0));
    const decisionLikes = decisionNodes.map((node) => _foldNodeToDecisionLike(node, msgMap));
    return _dedupeDecisions(decisionLikes);
  } catch {
    return [];
  }
}
function _foldNodeToDecisionLike(node, msgMap) {
  const rawId = node.id.replace(/^decision:/, "");
  const isLegacy = rawId.startsWith("_legacy_ord");
  return {
    ts: node.attrs._ts ?? null,
    msg: msgMap.get(node.attrs._ord) ?? node.attrs.title ?? node.attrs.decision ?? null,
    data: {
      id: isLegacy ? null : rawId,
      supersedes: node.attrs.supersedes ?? null,
      retires: node.attrs.retires ?? null,
      decision: node.attrs.decision ?? null
    }
  };
}
function _readDecisions(projectDir, motive) {
  const journalDir = join2(projectDir, ".groundwork", "journal");
  if (!existsSync4(journalDir))
    return [];
  try {
    const all = readAllEvents(journalDir);
    const { shown = [] } = filterEvents(all, { motive, type: "DECISION" });
    const latest = shown.slice().reverse();
    return _dedupeDecisions(latest);
  } catch {
    return [];
  }
}
function _dedupeDecisions(decisions) {
  const knownIds = new Set(decisions.map((d) => d.data?.id).filter(Boolean));
  const supersededIds = new Set;
  const descriptiveRetires = [];
  for (const d of decisions) {
    const s = d.data?.supersedes;
    if (s != null) {
      if (Array.isArray(s))
        s.forEach((id) => supersededIds.add(id));
      else
        supersededIds.add(s);
    }
    const r = d.data?.retires;
    if (r != null) {
      const refs = Array.isArray(r) ? r : [r];
      for (const ref of refs) {
        supersededIds.add(ref);
        if (!knownIds.has(ref))
          descriptiveRetires.push(ref);
      }
    }
  }
  const normText = (d) => (d.msg ?? JSON.stringify(d.data ?? "")).toLowerCase().replace(/\s+/g, " ").trim();
  const normSupersededTexts = new Set([...supersededIds].map((s) => s.toLowerCase().replace(/\s+/g, " ").trim()));
  const _sigTokens = (text) => text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 4);
  const _tokenOverlapMatches = (retiresRef, decisionNorm) => {
    const refTokens = _sigTokens(retiresRef);
    if (refTokens.length === 0)
      return false;
    const matchCount = refTokens.filter((t) => decisionNorm.includes(t)).length;
    const required = Math.max(2, Math.ceil(refTokens.length * 0.6));
    return matchCount >= required;
  };
  const active = supersededIds.size === 0 ? decisions : decisions.filter((d) => {
    const id = d.data?.id;
    if (id != null && supersededIds.has(id))
      return false;
    const dNorm = normText(d);
    if (normSupersededTexts.has(dNorm))
      return false;
    if (id == null && descriptiveRetires.length > 0 && descriptiveRetires.some((ref) => _tokenOverlapMatches(ref, dNorm)))
      return false;
    return true;
  });
  const norm = normText;
  const result = [];
  for (const d of active) {
    const dNorm = norm(d);
    let skip = false;
    let replaceIdx = -1;
    for (let i = 0;i < result.length; i++) {
      const rNorm = norm(result[i]);
      if (rNorm === dNorm) {
        skip = true;
        break;
      }
      if (rNorm.startsWith(dNorm)) {
        skip = true;
        break;
      }
      if (dNorm.startsWith(rNorm)) {
        replaceIdx = i;
        break;
      }
    }
    if (!skip) {
      if (replaceIdx >= 0)
        result[replaceIdx] = d;
      else
        result.push(d);
    }
  }
  const isJanitorialRetraction = (d) => d.data?.retires != null && (d.data?.decision ?? "").trimStart().toLowerCase().startsWith("retract");
  return result.filter((d) => !isJanitorialRetraction(d));
}
function _readOutOfScope(projectDir) {
  const dir = join2(projectDir, ".groundwork", "out-of-scope");
  if (!existsSync4(dir))
    return [];
  try {
    return readdirSync5(dir).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, "").replace(/-/g, " "));
  } catch {
    return [];
  }
}
function _readRejectionDecisions(projectDir, motive) {
  const journalDir = join2(projectDir, ".groundwork", "journal");
  if (!existsSync4(journalDir))
    return [];
  try {
    const all = readAllEvents(journalDir);
    const { shown = [] } = filterEvents(all, { motive, type: "DECISION" });
    const retiredTexts = new Set;
    for (const ev of shown) {
      const r = ev.data?.retires;
      if (r != null) {
        const refs = Array.isArray(r) ? r : [r];
        refs.forEach((ref) => retiredTexts.add(ref.toLowerCase().replace(/\s+/g, " ").trim()));
      }
    }
    const rejections = [];
    for (const ev of shown) {
      const normMsg = (ev.msg ?? "").toLowerCase().replace(/\s+/g, " ").trim();
      if (retiredTexts.has(normMsg))
        continue;
      const data = ev.data ?? {};
      const title = (data.title ?? "").toLowerCase();
      const msg = (ev.msg ?? "").toLowerCase();
      const isRejection = data.status === "rejected" || !!data.rejects || /\breject(ed|s)?\b/.test(title) || /\bnot adopted\b/.test(msg) || /\bdo not adopt\b/.test(msg) || /\brejected\b/.test(msg);
      if (!isRejection)
        continue;
      rejections.push(ev);
    }
    const firstSentence = (ev) => {
      const msg = (ev.msg ?? "").replace(/\s+/g, " ").trim();
      const cut = msg.indexOf(". ");
      return (cut >= 0 ? msg.slice(0, cut) : msg).toLowerCase();
    };
    const mergedInto = new Map;
    const absorbedIds = new Map;
    for (let i = 0;i < rejections.length; i++) {
      if (mergedInto.has(i))
        continue;
      const fsI = firstSentence(rejections[i]);
      for (let j = 0;j < rejections.length; j++) {
        if (i === j || mergedInto.has(j))
          continue;
        const fsJ = firstSentence(rejections[j]);
        if (fsJ === fsI)
          continue;
        if (fsI.startsWith(fsJ + " ") || fsI === fsJ) {
          mergedInto.set(j, i);
          const jId = rejections[j].data?.id;
          if (jId) {
            if (!absorbedIds.has(i))
              absorbedIds.set(i, new Set);
            absorbedIds.get(i).add(jId);
          }
        } else if (fsJ.startsWith(fsI + " ") || fsJ === fsI) {
          mergedInto.set(i, j);
          const iId = rejections[i].data?.id;
          if (iId) {
            if (!absorbedIds.has(j))
              absorbedIds.set(j, new Set);
            absorbedIds.get(j).add(iId);
          }
          break;
        }
      }
    }
    const seenLabels = new Set;
    const results = [];
    for (let i = 0;i < rejections.length; i++) {
      if (mergedInto.has(i))
        continue;
      const ev = rejections[i];
      const data = ev.data ?? {};
      let label = data.id ? `[${data.id}] ${data.title ?? ev.msg}` : data.title ?? ev.msg;
      const extra = absorbedIds.get(i);
      if (extra?.size) {
        label += ` (${[...extra].join(", ")})`;
      }
      const key = label.toLowerCase().trim();
      if (!seenLabels.has(key)) {
        seenLabels.add(key);
        results.push(label);
      }
    }
    return results;
  } catch {
    return [];
  }
}
function _readAllMotiveEvents(projectDir, motive) {
  const journalDir = join2(projectDir, ".groundwork", "journal");
  if (!existsSync4(journalDir))
    return [];
  try {
    const all = readAllEvents(journalDir);
    const { shown = [] } = filterEvents(all, { motive });
    return shown.slice().reverse();
  } catch {
    return [];
  }
}
function _buildJournalAcCoverage(events) {
  const completedSlices = new Set;
  for (const ev of events) {
    if (ev.type === "TASK_COMPLETE" && ev.data?.slice != null) {
      completedSlices.add(String(ev.data.slice));
    }
  }
  const acMap = new Map;
  for (const ev of events) {
    if (ev.type !== "AC_COVERAGE")
      continue;
    const d = ev.data ?? {};
    const acIds = [];
    if (d.ac != null)
      acIds.push(String(d.ac));
    if (Array.isArray(d.covers)) {
      for (const a of d.covers) {
        if (a != null)
          acIds.push(String(a));
      }
    }
    const sliceId = d.slice != null ? String(d.slice) : null;
    if (sliceId == null) {
      for (const acId of acIds) {
        if (!acMap.has(acId))
          acMap.set(acId, new Map);
      }
      continue;
    }
    const status = completedSlices.has(sliceId) ? "complete" : "pending";
    for (const acId of acIds) {
      if (!acMap.has(acId))
        acMap.set(acId, new Map);
      acMap.get(acId).set(sliceId, { id: sliceId, status });
    }
  }
  for (const ev of events) {
    if (ev.type !== "AC_RETRACTION")
      continue;
    const d = ev.data ?? {};
    const acId = d.ac != null ? String(d.ac) : null;
    const sliceId = d.slice != null ? String(d.slice) : null;
    if (acId == null || sliceId == null)
      continue;
    const slicesMap = acMap.get(acId);
    if (slicesMap)
      slicesMap.delete(sliceId);
  }
  const result = new Map;
  for (const [acId, slicesMap] of acMap) {
    result.set(acId, [...slicesMap.values()]);
  }
  return result;
}
function _buildAcRetractions(events) {
  const retractions = new Map;
  for (const ev of events) {
    if (ev.type !== "AC_RETRACTION")
      continue;
    const d = ev.data ?? {};
    const acId = d.ac != null ? String(d.ac) : null;
    const sliceId = d.slice != null ? String(d.slice) : null;
    if (acId == null || sliceId == null)
      continue;
    if (!retractions.has(acId))
      retractions.set(acId, new Set);
    retractions.get(acId).add(sliceId);
  }
  return retractions;
}
function _extractBareSliceId(id) {
  const sep = id.indexOf("::");
  return sep === -1 ? id : id.slice(sep + 2);
}
function _renderMap({ motive, charter, slices, ledgerDoc = null, decisions, outOfScope, rejectionDecisions = [], ticketFiles = [], acSlices = null, journalAcCoverage = null, acRetractions = null, lastPause = null }) {
  const parts = [];
  parts.push(`# MAP: ${motive}`);
  parts.push("");
  parts.push("## Destination");
  parts.push("");
  const objective = charter?.objective?.trim();
  if (objective) {
    parts.push(objective);
  } else {
    parts.push("_No objective recorded yet._");
  }
  parts.push("");
  const _decisionSlicesMap = new Map;
  for (const s of slices) {
    const decIds = s.decisions == null ? [] : Array.isArray(s.decisions) ? s.decisions : String(s.decisions).split(",").map((x) => x.trim()).filter(Boolean);
    for (const did of decIds) {
      if (!_decisionSlicesMap.has(did))
        _decisionSlicesMap.set(did, []);
      _decisionSlicesMap.get(did).push({ id: s.id, status: s.status ?? "pending" });
    }
  }
  parts.push("## Decisions so far");
  parts.push("");
  if (decisions.length) {
    for (const d of decisions) {
      const ts = (d.ts ?? "").slice(0, 10);
      const msg = d.msg ?? JSON.stringify(d.data ?? "");
      let edgeSuffix = "";
      const did = d.data?.id;
      if (did != null) {
        const refs = _decisionSlicesMap.get(did);
        if (refs?.length) {
          edgeSuffix = " \u2192 " + refs.map((r) => `${r.id} (${r.status === "complete" ? "complete" : "pending"})`).join(", ");
        }
      }
      parts.push(`- ${ts ? `[${ts}] ` : ""}${msg}${edgeSuffix}`);
    }
  } else {
    parts.push("_No decisions recorded yet._");
  }
  parts.push("");
  const completeIds = new Set(slices.filter((s) => s.status === "complete").map((s) => s.id));
  const inProgressList = slices.filter((s) => s.status === "in_progress" || s.claimed_by && s.status !== "complete");
  const blockedList = slices.filter((s) => {
    if (s.status === "complete" || s.status === "in_progress")
      return false;
    if (s.claimed_by)
      return false;
    const deps = _deps(s);
    return deps.length > 0 && deps.some((d) => !completeIds.has(d));
  });
  const frontierList = frontier(slices).filter((s) => !s.claimed_by);
  const _decSuffix = (s) => {
    const decIds = s.decisions == null ? [] : Array.isArray(s.decisions) ? s.decisions : String(s.decisions).split(",").map((x) => x.trim()).filter(Boolean);
    return decIds.length ? ` _(decisions: ${decIds.join(", ")})_` : "";
  };
  parts.push("## Frontier");
  parts.push("");
  parts.push("_Slices that can start now (no pending blockers):_");
  parts.push("");
  if (frontierList.length) {
    for (const s of frontierList) {
      parts.push(`- ${_sliceLink(s.id, s.ticket)} \u2014 ${s.desc ?? "(no description)"}${_decSuffix(s)}`);
    }
  } else {
    parts.push("_No frontier slices \u2014 everything is in progress, blocked, or complete._");
  }
  parts.push("");
  if (inProgressList.length || blockedList.length) {
    parts.push("## In progress / Blocked");
    parts.push("");
    if (inProgressList.length) {
      parts.push("**In progress:**");
      parts.push("");
      for (const s of inProgressList) {
        const claim = s.claimed_by ? ` _(claimed by ${s.claimed_by})_` : "";
        parts.push(`- ${_sliceLink(s.id, s.ticket)}${claim} \u2014 ${s.desc ?? "(no description)"}${_decSuffix(s)}`);
      }
      parts.push("");
    }
    if (blockedList.length) {
      parts.push("**Blocked:**");
      parts.push("");
      for (const s of blockedList) {
        const pending = _deps(s).filter((d) => !completeIds.has(d));
        parts.push(`- ${_sliceLink(s.id, s.ticket)} \u2014 ${s.desc ?? "(no description)"} _(waiting on: ${pending.join(", ")})_${_decSuffix(s)}`);
      }
      parts.push("");
    }
  }
  if (ticketFiles.length > 0) {
    const sliceByTicketStem = new Map;
    for (const s of slices) {
      if (s.ticket) {
        const safe = sanitizeId(String(s.ticket));
        if (safe)
          sliceByTicketStem.set(safe, s);
      }
    }
    const ticketStemSet = new Set(ticketFiles.map((t) => t.stem));
    const unlinkedSlices = slices.filter((s) => {
      if (!s.ticket)
        return true;
      const safe = sanitizeId(String(s.ticket));
      return !safe || !ticketStemSet.has(safe);
    });
    parts.push("## Tickets");
    parts.push("");
    const byType = new Map;
    for (const { stem, type } of ticketFiles) {
      const key = TICKET_TYPE_ORDER.includes(type) ? type : "other";
      if (!byType.has(key))
        byType.set(key, []);
      byType.get(key).push(stem);
    }
    const renderOrder = TICKET_TYPE_ORDER.filter((t) => byType.has(t));
    if (byType.has("other"))
      renderOrder.push("other");
    for (const typeKey of renderOrder) {
      parts.push(`### ${typeKey}`);
      parts.push("");
      for (const stem of byType.get(typeKey)) {
        const slice = sliceByTicketStem.get(stem);
        const badge = slice ? _statusBadge(slice.status ?? "pending") : _statusBadge("no-slice");
        const desc = slice?.desc ? ` \u2014 ${slice.desc}` : "";
        parts.push(`- [${stem}](tickets/${stem}.md) ${badge}${desc}`);
      }
      parts.push("");
    }
    if (unlinkedSlices.length > 0) {
      parts.push("**Unlinked slices** _(no ticket document):_");
      parts.push("");
      for (const s of unlinkedSlices) {
        parts.push(`- ${_sliceLink(s.id, undefined)} \u2014 ${s.desc ?? "(no description)"}`);
      }
      parts.push("");
    }
  }
  parts.push("## Open items");
  parts.push("");
  const openItems = (charter?.open_items ?? []).filter((item) => !item.resolved_by);
  if (openItems.length) {
    for (const item of openItems) {
      const owner = item.owner ? ` @${item.owner}` : "";
      const blocker = item.blocked_by ? ` _(blocked by ${item.blocked_by})_` : "";
      const statement = (item.statement ?? "").trim();
      parts.push(`- ${_openItemLink(item.id)}: ${statement}${owner}${blocker}`);
    }
  } else {
    parts.push("_No open items._");
  }
  parts.push("");
  parts.push("## Out of scope");
  parts.push("");
  const charterOos = charter?.out_of_scope?.trim();
  const hasCharterOos = charterOos && !charterOos.startsWith("<!--") && charterOos.length > 0;
  if (hasCharterOos) {
    parts.push(charterOos);
    parts.push("");
  }
  const seenOos = new Set;
  const allOos = [];
  for (const entry of [...outOfScope, ...rejectionDecisions]) {
    const key = entry.toLowerCase().trim();
    if (!seenOos.has(key)) {
      seenOos.add(key);
      allOos.push(entry);
    }
  }
  if (allOos.length) {
    for (const entry of allOos) {
      parts.push(`- ${entry}`);
    }
  } else if (!hasCharterOos) {
    parts.push("_Nothing explicitly ruled out yet._");
  }
  parts.push("");
  const acList = charter?.acceptance_criteria ?? [];
  if (acList.length > 0) {
    const acSourceSlices = acSlices ?? slices;
    const acSlicesMap = new Map;
    const charterAcKeys = new Set;
    for (const ac of acList) {
      if (ac?.id != null) {
        acSlicesMap.set(String(ac.id), []);
        charterAcKeys.add(String(ac.id));
      }
    }
    for (const s of acSourceSlices) {
      const raw = s.covers_ac;
      const acIds = Array.isArray(raw) ? raw : typeof raw === "string" && raw ? raw.split(",").map((x) => x.trim()).filter(Boolean) : [];
      for (const acId of acIds) {
        if (!acSlicesMap.has(acId)) {
          acSlicesMap.set(acId, []);
        }
        const compositeId = s._session_id ? `${s._session_id}::${s.id}` : s.id;
        acSlicesMap.get(acId).push({ id: compositeId, status: s.status ?? "pending" });
      }
    }
    const acStatementMap = new Map;
    for (const ac of acList) {
      if (ac?.id != null && ac.statement)
        acStatementMap.set(String(ac.id), ac.statement);
    }
    parts.push("## Acceptance criteria");
    parts.push("");
    const charterAcIds = acList.filter((ac) => ac?.id != null).map((ac) => String(ac.id));
    const undeclaredAcIds = [...acSlicesMap.keys()].filter((k) => !charterAcKeys.has(k)).sort();
    const orderedAcIds = [...charterAcIds, ...undeclaredAcIds];
    for (const key of orderedAcIds) {
      const ledgerCovering = acSlicesMap.get(key) ?? [];
      const retractedBareIds = acRetractions?.get(key);
      const ledgerCoveringFiltered = retractedBareIds && retractedBareIds.size > 0 ? ledgerCovering.filter((s) => !retractedBareIds.has(_extractBareSliceId(s.id))) : ledgerCovering;
      const covering = ledgerCoveringFiltered.length > 0 ? ledgerCoveringFiltered : journalAcCoverage?.get(key) ?? [];
      const rawStmt = acStatementMap.get(key) ?? "";
      const stmt = rawStmt.length > 120 ? rawStmt.slice(0, 117) + "\u2026" : rawStmt;
      const stmtSuffix = stmt ? ` \u2014 ${stmt}` : charterAcKeys.has(key) ? "" : " \u2014 _(not declared in charter)_";
      const isMet = covering.length > 0 && covering.every((s) => s.status === "complete");
      if (isMet) {
        const coverIds = covering.map((s) => s.id).join(", ");
        parts.push(`- \u2713 **${key}** \u2014 met (covered by: ${coverIds})${stmtSuffix}`);
      } else if (covering.length === 0) {
        parts.push(`- \u26A0 **${key}** \u2014 PLANNING HOLE: no covering slices assigned${stmtSuffix}`);
      } else {
        const incomplete = covering.filter((s) => s.status !== "complete");
        parts.push(`- \u2717 **${key}** \u2014 covered, incomplete (slices: ${incomplete.map((s) => s.id).join(", ")})${stmtSuffix}`);
      }
    }
    parts.push("");
  }
  if (slices.length > 0) {
    const doneSlices = slices.filter((s) => s.status === "complete");
    parts.push("## Progress");
    parts.push("");
    parts.push(`${doneSlices.length} / ${slices.length} slices complete`);
    if (doneSlices.length > 0) {
      parts.push("");
      for (const s of doneSlices) {
        const desc = s.desc ? ` \u2014 ${s.desc}` : "";
        parts.push(`- \u2713 ${_sliceLink(s.id, s.ticket)}${desc}`);
      }
    }
    parts.push("");
  }
  if (ledgerDoc?.pacing) {
    const pacing = ledgerDoc.pacing;
    const budget = pacing.budget ?? 1;
    const grant = pacing.grant ?? null;
    const grantRange = grant?.range ?? 0;
    const cap = budget + grantRange;
    const unitWord = pacing.policy === "wave" ? "wave" : "slice";
    const resolved = resolvedUnits(ledgerDoc);
    const inflight = inFlightUnit(ledgerDoc);
    const exhausted = isExhausted(ledgerDoc);
    parts.push("## Pacing");
    parts.push("");
    const budgetLine = grantRange > 0 ? `**Policy:** ${pacing.policy} \xB7 **Budget:** ${budget} ${unitWord}${budget === 1 ? "" : "s"} + ${grantRange} via autopilot (cap ${cap})` : `**Policy:** ${pacing.policy} \xB7 **Budget:** ${budget} ${unitWord}${budget === 1 ? "" : "s"}`;
    parts.push(budgetLine);
    parts.push(`**Consumption:** ${resolved} of ${cap} ${unitWord}${cap === 1 ? "" : "s"} resolved \u2014 ${resolved < cap ? "new unit may be started" : "budget consumed"}`);
    if (inflight !== null) {
      const label = pacing.policy === "wave" ? `wave ${inflight}` : `"${inflight}"`;
      parts.push(`**In-flight ${unitWord}:** ${label}`);
    }
    if (grant) {
      const grantedBy = grant.granted_by ? ` by ${grant.granted_by}` : "";
      const grantedAt = grant.granted_at ? ` (${String(grant.granted_at).slice(0, 10)})` : "";
      const reason = grant.reason ? ` \u2014 ${grant.reason}` : "";
      parts.push(`**Autopilot grant:** +${grant.range} ${unitWord}${grant.range === 1 ? "" : "s"}${grantedBy}${grantedAt}${reason}`);
    }
    if (exhausted) {
      const exemptKinds = pacing.exempt_kinds ?? [];
      const remaining = (ledgerDoc.slices ?? []).filter((s) => !exemptKinds.includes(s.kind) && s.status !== "complete");
      const ids = remaining.map((s) => s.id).join(", ");
      parts.push(`**Session exhausted.** Run \`/groundwork:pause\` and open a new session. Remaining work: ${ids || "(none listed)"}`);
    }
    parts.push("");
  }
  if (lastPause != null) {
    parts.push("## Pause");
    parts.push("");
    if (lastPause.pointer)
      parts.push(`**Pointer:** ${lastPause.pointer}`);
    if (lastPause.summary)
      parts.push(lastPause.summary);
    if (Array.isArray(lastPause.next_actions) && lastPause.next_actions.length > 0) {
      parts.push("");
      parts.push("**Next actions:**");
      parts.push("");
      for (const na of lastPause.next_actions) {
        parts.push(`- **${na.action}:** ${na.detail ?? ""}`);
      }
    }
    parts.push("");
  }
  parts.push("---");
  parts.push("_Auto-generated \u2014 refreshed automatically by ledger/journal CLIs. Do not edit by hand._");
  return parts.join(`
`) + `
`;
}
function _statusBadge(status) {
  switch (status) {
    case "complete":
      return "(complete)";
    case "in_progress":
      return "(in progress)";
    case "pending":
      return "(pending)";
    case "no-slice":
      return "(unstarted \u2014 no slice)";
    default:
      return `(${status})`;
  }
}
function _deps(slice) {
  if (Array.isArray(slice.blocked_by))
    return slice.blocked_by;
  if (slice.blocked_by)
    return [slice.blocked_by];
  return [];
}
function _sliceLink(id, ticketRef) {
  if (ticketRef) {
    const safe = sanitizeId(ticketRef);
    if (safe)
      return `[${id}](tickets/${safe}.md)`;
  }
  const safeId = sanitizeId(id);
  return safeId ? `**${id}**` : `**${id}**`;
}
function _openItemLink(id) {
  const safe = sanitizeId(id);
  return safe ? `[${id}](open-items/${safe}.md)` : `**${id}**`;
}

// hooks/lib/traceability-ambient.mjs
import { writeFileSync as writeFileSync5, existsSync as existsSync7 } from "fs";
import { join as join4 } from "path";

// hooks/lib/traceability-model.mjs
var TRACEABILITY_EXTENDED_NODE_TYPES = new Set([
  "self-test",
  "live-verify",
  "gate",
  "artifact-evidence"
]);
var ALL_TRACEABILITY_NODE_TYPES = new Set([
  "objective",
  "decision",
  "open-item",
  "ticket",
  "acceptance-criterion",
  "slice",
  "spec-requirement",
  "self-test",
  "live-verify",
  "gate",
  "artifact-evidence"
]);
function makeSelfTestNode({ sliceId, filePath, source = "direct" }) {
  return {
    type: "self-test",
    id: `self-test:${sliceId}:${filePath}`,
    sliceId,
    filePath,
    source,
    label: filePath.split("/").pop() ?? filePath
  };
}
function makeLiveVerifyNode({ claim, evidence, result, ord }) {
  return {
    type: "live-verify",
    id: `live-verify:${ord}`,
    claim,
    evidence,
    result,
    ord,
    label: claim ?? `verification #${ord}`
  };
}
function makeGateNode({ which, verdict, citation = null, rubric = null }) {
  return {
    type: "gate",
    id: `gate:${which}`,
    which,
    verdict,
    citation,
    rubric,
    label: `${which} (${verdict})`
  };
}
function makeArtifactEvidenceNode({ ref, hash = null, kind = "other" }) {
  return {
    type: "artifact-evidence",
    id: `artifact-evidence:${ref}`,
    ref,
    hash,
    kind,
    label: ref.split("/").pop() ?? ref
  };
}
function makeEdge(source, target, kind) {
  return { source, target, kind };
}

// hooks/lib/traceability-join.mjs
function makeObjectiveNode(slug, text) {
  const trimmed = typeof text === "string" ? text : "";
  return {
    type: "objective",
    id: `objective:${slug}`,
    slug,
    text: trimmed,
    label: trimmed.length > 80 ? trimmed.slice(0, 77) + "\u2026" : trimmed
  };
}
function makeSpecReqNode(req) {
  return {
    type: "spec-requirement",
    id: `spec-requirement:${req.id}`,
    reqId: req.id,
    title: req.title,
    verification: req.verification,
    criticality: req.criticality,
    originDecisionRef: req.origin_decision_ref,
    label: req.title || req.id
  };
}
function makeSliceNode(slice) {
  const desc = slice.desc ?? null;
  return {
    type: "slice",
    id: `slice:${slice.id}`,
    sliceId: slice.id,
    status: slice.status,
    desc,
    wave: slice.wave ?? null,
    label: desc ? `${slice.id}: ${desc}` : slice.id
  };
}
function sortById(arr) {
  return [...arr].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
function edgeKey(e) {
  return `${e.source}\x00${e.target}\x00${e.kind}`;
}
function sortEdges(arr) {
  return [...arr].sort((a, b) => {
    const ka = edgeKey(a);
    const kb = edgeKey(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}
function dedupeEdges(arr) {
  const seen = new Set;
  const out = [];
  for (const e of arr) {
    const k = edgeKey(e);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(e);
    }
  }
  return out;
}
function buildTraceabilityGraph(adapter) {
  const slug = adapter.getMotive();
  const objectiveText = adapter.getObjective();
  const slices = adapter.getSlices();
  const specReqs = adapter.getSpecRequirements();
  const verificationEvents = adapter.getVerificationEvents();
  const gateEvents = adapter.getGateEvents();
  const coverageMap = adapter.getCoverageMap();
  const nodes = [];
  const rawEdges = [];
  const objectiveNode = makeObjectiveNode(slug, objectiveText);
  nodes.push(objectiveNode);
  const sortedSpecReqs = [...specReqs].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const specReqNodeById = {};
  for (const req of sortedSpecReqs) {
    const srNode = makeSpecReqNode(req);
    nodes.push(srNode);
    specReqNodeById[req.id] = srNode;
    rawEdges.push(makeEdge(srNode.id, objectiveNode.id, "covers"));
  }
  const decisionRefToSrIds = {};
  for (const req of sortedSpecReqs) {
    if (req.origin_decision_ref) {
      const key = req.origin_decision_ref;
      if (!Object.prototype.hasOwnProperty.call(decisionRefToSrIds, key)) {
        decisionRefToSrIds[key] = [];
      }
      decisionRefToSrIds[key].push(`spec-requirement:${req.id}`);
    }
  }
  for (const key of Object.keys(decisionRefToSrIds)) {
    decisionRefToSrIds[key].sort();
  }
  const testPathToSrIds = {};
  const covReqIds = Object.keys(coverageMap).sort();
  for (const reqId of covReqIds) {
    const entry = coverageMap[reqId];
    const tests = Array.isArray(entry?.tests) ? [...entry.tests].sort() : [];
    for (const testPath of tests) {
      if (!Object.prototype.hasOwnProperty.call(testPathToSrIds, testPath)) {
        testPathToSrIds[testPath] = [];
      }
      testPathToSrIds[testPath].push(`spec-requirement:${reqId}`);
    }
  }
  for (const key of Object.keys(testPathToSrIds)) {
    testPathToSrIds[key].sort();
  }
  const sortedSlices = [...slices].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const sliceIdSet = new Set(sortedSlices.map((s) => s.id));
  const selfTestNodes = [];
  for (const slice of sortedSlices) {
    const sliceNode = makeSliceNode(slice);
    nodes.push(sliceNode);
    const blockers2 = [...slice.blocked_by ?? []].sort();
    for (const blockerId of blockers2) {
      if (sliceIdSet.has(blockerId)) {
        rawEdges.push(makeEdge(sliceNode.id, `slice:${blockerId}`, "blocked_by"));
      }
    }
    const coversAc = [...slice.covers_ac ?? []].sort();
    for (const acId of coversAc) {
      if (Object.prototype.hasOwnProperty.call(specReqNodeById, acId)) {
        rawEdges.push(makeEdge(sliceNode.id, `spec-requirement:${acId}`, "covers"));
      }
    }
    const decisions = [...slice.decisions ?? []].sort();
    for (const decRef of decisions) {
      const srIds = decisionRefToSrIds[decRef];
      if (srIds) {
        for (const srId of srIds) {
          rawEdges.push(makeEdge(sliceNode.id, srId, "covers"));
        }
      }
    }
    const testPaths = [...slice.test_paths ?? []].sort();
    if (testPaths.length > 0) {
      for (const filePath of testPaths) {
        const stNode = makeSelfTestNode({ sliceId: slice.id, filePath, source: "direct" });
        selfTestNodes.push(stNode);
        rawEdges.push(makeEdge(stNode.id, sliceNode.id, "verifies"));
      }
    } else if (decisions.length > 0) {
      const covTestPaths = new Set;
      for (const decRef of decisions) {
        const srIds = decisionRefToSrIds[decRef] ?? [];
        for (const srId of srIds) {
          const reqId = srId.slice("spec-requirement:".length);
          const entry = coverageMap[reqId];
          if (entry?.tests) {
            for (const t of entry.tests) {
              covTestPaths.add(t);
            }
          }
        }
      }
      for (const filePath of [...covTestPaths].sort()) {
        const stNode = makeSelfTestNode({ sliceId: slice.id, filePath, source: "decision-mediated" });
        selfTestNodes.push(stNode);
        rawEdges.push(makeEdge(stNode.id, sliceNode.id, "verifies"));
      }
    }
  }
  nodes.push(...selfTestNodes);
  const sortedVerifications = [...verificationEvents].sort((a, b) => a.ord - b.ord);
  for (const ev of sortedVerifications) {
    const lvNode = makeLiveVerifyNode({
      claim: ev.claim,
      evidence: ev.evidence,
      result: ev.result,
      ord: ev.ord
    });
    nodes.push(lvNode);
    const linkId = ev.linkId ?? null;
    const target = linkId && sliceIdSet.has(linkId) ? `slice:${linkId}` : objectiveNode.id;
    rawEdges.push(makeEdge(lvNode.id, target, "confirms"));
  }
  const sortedGates = [...gateEvents].sort((a, b) => a.which < b.which ? -1 : a.which > b.which ? 1 : 0);
  for (const ev of sortedGates) {
    const gNode = makeGateNode({
      which: ev.which,
      verdict: ev.verdict,
      citation: ev.citation ?? null,
      rubric: ev.rubric ?? null
    });
    nodes.push(gNode);
    const linkId = ev.linkId ?? null;
    const target = linkId && sliceIdSet.has(linkId) ? `slice:${linkId}` : objectiveNode.id;
    rawEdges.push(makeEdge(gNode.id, target, "seals"));
  }
  return {
    nodes: sortById(nodes),
    edges: sortEdges(dedupeEdges(rawEdges)),
    artifactEvidence: []
  };
}

// hooks/lib/traceability-classify.mjs
function edgeKey2(e) {
  return `${e.source}\x00${e.target}\x00${e.kind}`;
}
function sortById2(arr) {
  return [...arr].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
function sortEdges2(arr) {
  return [...arr].sort((a, b) => {
    const ka = edgeKey2(a);
    const kb = edgeKey2(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}
function classifyEdge(edge, ctx) {
  const {
    nodeById,
    approvedTargets,
    objectiveApproved,
    evidenceFreshness,
    specReqCoveringSlices
  } = ctx;
  const { source, target, kind } = edge;
  const isStale = (nodeId) => evidenceFreshness.get(nodeId) === "stale";
  switch (kind) {
    case "seals": {
      const gateNode = nodeById.get(source);
      if (!gateNode || gateNode.verdict !== "APPROVE")
        return "unproven";
      if (isStale(target))
        return "stale";
      return "proven";
    }
    case "confirms": {
      const lvNode = nodeById.get(source);
      if (!lvNode || lvNode.result !== "pass")
        return "unproven";
      if (isStale(target))
        return "stale";
      return "proven";
    }
    case "verifies": {
      const testFreshness = evidenceFreshness.get(source);
      if (testFreshness === "stale")
        return "stale";
      if (testFreshness === "fresh")
        return "proven";
      if (approvedTargets.has(target) || objectiveApproved)
        return "proven";
      return "unproven";
    }
    case "covers": {
      const sourceNode = nodeById.get(source);
      if (!sourceNode)
        return "unproven";
      if (sourceNode.type === "slice") {
        if (isStale(source))
          return "stale";
        if (approvedTargets.has(source) || objectiveApproved)
          return "proven";
        return "unproven";
      }
      if (sourceNode.type === "spec-requirement") {
        const coveringSlices = specReqCoveringSlices.get(source);
        if (!coveringSlices || coveringSlices.size === 0)
          return "missing";
        let anyApproved = false;
        let anyStale = false;
        for (const sliceNodeId of coveringSlices) {
          if (isStale(sliceNodeId))
            anyStale = true;
          if (approvedTargets.has(sliceNodeId) || objectiveApproved)
            anyApproved = true;
        }
        if (anyApproved) {
          return anyStale ? "stale" : "proven";
        }
        if (anyStale)
          return "stale";
        return "unproven";
      }
      return "unproven";
    }
    case "evidences": {
      return evidenceFreshness.get(source) === "fresh" ? "proven" : "stale";
    }
    default:
      return "unproven";
  }
}
function classifyTraceabilityGraph(graph, stampedRefs = []) {
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const objectiveNode = graph.nodes.find((n) => n.type === "objective");
  const approvedTargets = new Set;
  for (const edge of graph.edges) {
    if (edge.kind !== "seals")
      continue;
    const gateNode = nodeById.get(edge.source);
    if (gateNode && gateNode.verdict === "APPROVE") {
      approvedTargets.add(edge.target);
    }
  }
  const objectiveApproved = objectiveNode ? approvedTargets.has(objectiveNode.id) : false;
  const specReqCoveringSlices = new Map;
  for (const node of graph.nodes) {
    if (node.type === "spec-requirement") {
      specReqCoveringSlices.set(node.id, new Set);
    }
  }
  for (const edge of graph.edges) {
    if (edge.kind !== "covers")
      continue;
    const srcNode = nodeById.get(edge.source);
    if (srcNode?.type === "slice") {
      const bucket = specReqCoveringSlices.get(edge.target);
      if (bucket)
        bucket.add(edge.source);
    }
  }
  const evidenceFreshness = new Map;
  for (const ref of stampedRefs) {
    for (const evidencedNodeId of ref.evidences) {
      const current = evidenceFreshness.get(evidencedNodeId);
      if (current !== "stale") {
        evidenceFreshness.set(evidencedNodeId, ref.freshness);
      }
    }
  }
  const artifactNodes = [];
  const artifactEdges = [];
  const seenNodeIds = new Set;
  const seenEdgeKeys = new Set;
  for (const ref of stampedRefs) {
    const evidNode = makeArtifactEvidenceNode({
      ref: ref.path,
      hash: ref.captured_build_hash,
      kind: ref.kind
    });
    if (!seenNodeIds.has(evidNode.id)) {
      seenNodeIds.add(evidNode.id);
      artifactNodes.push(evidNode);
    }
    const edgeClassification = ref.freshness === "fresh" ? "proven" : "stale";
    for (const targetId of ref.evidences) {
      const rawEdge = makeEdge(evidNode.id, targetId, "evidences");
      const key = edgeKey2(rawEdge);
      if (!seenEdgeKeys.has(key)) {
        seenEdgeKeys.add(key);
        artifactEdges.push({ ...rawEdge, classification: edgeClassification });
      }
    }
  }
  const ctx = {
    nodeById,
    approvedTargets,
    objectiveApproved,
    evidenceFreshness,
    specReqCoveringSlices
  };
  const classifiedEdges = graph.edges.map((edge) => ({
    ...edge,
    classification: classifyEdge(edge, ctx)
  }));
  const sortedArtifactNodes = sortById2(artifactNodes);
  const sortedArtifactEdges = sortEdges2(artifactEdges);
  const allNodes = sortById2([...graph.nodes, ...sortedArtifactNodes]);
  const allEdges = sortEdges2([...classifiedEdges, ...sortedArtifactEdges]);
  return {
    nodes: allNodes,
    edges: allEdges,
    artifactEvidence: sortedArtifactNodes
  };
}

// hooks/lib/traceability-ambient.mjs
var TIER_ORDER = [
  "objective",
  "spec-requirement",
  "slice",
  "self-test",
  "live-verify",
  "gate",
  "artifact-evidence"
];
var TIER_LABELS = {
  objective: "Objective",
  "spec-requirement": "Spec Requirements",
  slice: "Slices",
  "self-test": "Self-Tests",
  "live-verify": "Live Verifications",
  gate: "Gate Verdicts",
  "artifact-evidence": "Artifact Evidence"
};
var SVG_W = 1100;
var TIER_H = 110;
var NODE_W = 150;
var NODE_H = 38;
var PAD_X = 60;
var PAD_TOP = 20;
var EDGE_STYLE = {
  proven: { stroke: "#22c55e", dasharray: null, opacity: "0.85", width: "2" },
  unproven: { stroke: "#d97706", dasharray: "5,4", opacity: "0.75", width: "1.5" },
  stale: { stroke: "#ef4444", dasharray: "8,3,2,3", opacity: "0.85", width: "2" },
  missing: { stroke: "#dc2626", dasharray: "3,5", opacity: "0.80", width: "1.5" }
};
function esc(s) {
  if (s == null)
    return "";
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function shortLabel(node) {
  if (node.label && node.label !== node.id)
    return node.label;
  const id = String(node.id ?? "");
  const colon = id.indexOf(":");
  return colon >= 0 ? id.slice(colon + 1) : id;
}
function computeLayout(nodes, edges = []) {
  const sliceNodes = nodes.filter((n) => String(n.type ?? "") === "slice");
  const nonSliceNodes = nodes.filter((n) => String(n.type ?? "") !== "slice");
  const sliceIdSet = new Set(sliceNodes.map((n) => String(n.id)));
  const sliceEdgeBlockers = new Map;
  for (const edge of edges) {
    if (edge.kind === "blocked_by") {
      const src = String(edge.source);
      const tgt = String(edge.target);
      if (sliceIdSet.has(src) && sliceIdSet.has(tgt)) {
        if (!sliceEdgeBlockers.has(src))
          sliceEdgeBlockers.set(src, []);
        sliceEdgeBlockers.get(src).push(tgt);
      }
    }
  }
  const dagSlices = sliceNodes.map((n) => ({
    id: String(n.id),
    blocked_by: Array.isArray(n.blocked_by) ? n.blocked_by : sliceEdgeBlockers.get(String(n.id)) ?? [],
    status: String(n.status ?? "pending"),
    wave: n.wave ?? null,
    kind: String(n.kind ?? "impl")
  }));
  const cycleDetected = hasCycle(dagSlices);
  const topoResult = cycleDetected ? [] : topoLayers(dagSlices);
  const topoWaveById = new Map;
  for (let i2 = 0;i2 < topoResult.length; i2++) {
    for (const id of topoResult[i2])
      topoWaveById.set(id, i2);
  }
  const waveById = new Map;
  for (const s of dagSlices) {
    const w = s.wave != null ? s.wave : topoWaveById.get(s.id) ?? null;
    waveById.set(s.id, w);
  }
  const frontierSlices = frontier(dagSlices);
  const frontierIds = new Set(frontierSlices.map((s) => s.id));
  const blockerChains = new Map;
  for (const s of dagSlices) {
    const bl = s.blocked_by;
    if (Array.isArray(bl) && bl.length > 0) {
      const chain = transitiveBlockers(dagSlices, s.id);
      if (chain.length > 0)
        blockerChains.set(s.id, chain);
    }
  }
  const waveGroups = new Map;
  for (const n of sliceNodes) {
    const w = waveById.get(String(n.id)) ?? 0;
    if (!waveGroups.has(w))
      waveGroups.set(w, []);
    waveGroups.get(w).push(n);
  }
  const sortedWaves = [...waveGroups.keys()].sort((a, b) => a - b);
  const byTier = new Map;
  for (const t of TIER_ORDER) {
    if (t !== "slice")
      byTier.set(t, []);
  }
  const unknownTier = [];
  for (const n of nonSliceNodes) {
    const t = String(n.type ?? "");
    if (byTier.has(t)) {
      byTier.get(t).push(n);
    } else {
      unknownTier.push(n);
    }
  }
  const PRE_SLICE = ["objective", "spec-requirement"];
  const POST_SLICE = ["self-test", "live-verify", "gate", "artifact-evidence"];
  const tierBands = [];
  let y = PAD_TOP;
  for (const tier of PRE_SLICE) {
    const tierNodes = byTier.get(tier) ?? [];
    if (tierNodes.length === 0)
      continue;
    tierBands.push({ tier, label: TIER_LABELS[tier] ?? tier, y, nodes: tierNodes });
    y += TIER_H;
  }
  for (const w of sortedWaves) {
    const waveNodes = waveGroups.get(w) ?? [];
    if (waveNodes.length === 0)
      continue;
    const label = sortedWaves.length === 1 ? TIER_LABELS["slice"] : `Slices \u2014 Wave ${w}`;
    tierBands.push({ tier: "slice", label, y, nodes: waveNodes });
    y += TIER_H;
  }
  for (const tier of POST_SLICE) {
    const tierNodes = byTier.get(tier) ?? [];
    if (tierNodes.length === 0)
      continue;
    tierBands.push({ tier, label: TIER_LABELS[tier] ?? tier, y, nodes: tierNodes });
    y += TIER_H;
  }
  if (unknownTier.length > 0) {
    tierBands.push({ tier: "unknown", label: "Unknown", y, nodes: unknownTier });
    y += TIER_H;
  }
  const svgH = y + PAD_TOP;
  const positions = new Map;
  for (const band of tierBands) {
    const count = band.nodes.length;
    if (count === 0)
      continue;
    const usableW = SVG_W - 2 * PAD_X;
    const spacing = count === 1 ? 0 : usableW / (count - 1);
    const startX = count === 1 ? SVG_W / 2 : PAD_X;
    for (let i2 = 0;i2 < count; i2++) {
      const n = band.nodes[i2];
      const x = count === 1 ? startX : startX + i2 * spacing;
      const nodeY = band.y + TIER_H / 2;
      positions.set(String(n.id), { x, y: nodeY, tier: band.tier });
    }
  }
  return { positions, tierBands, svgH, frontierIds, blockerChains, cycleDetected };
}
function renderSvg(nodes, edges, positions, tierBands, svgH, frontierIds, blockerChains) {
  const lines = [];
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_W} ${svgH}" width="${SVG_W}" height="${svgH}" role="img" aria-label="Traceability chain">`);
  lines.push(`  <defs>`);
  lines.push(`    <pattern id="stale-hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">`);
  lines.push(`      <line x1="0" y1="0" x2="0" y2="6" stroke="#ef4444" stroke-width="2"/>`);
  lines.push(`    </pattern>`);
  lines.push(`  </defs>`);
  for (let i2 = 0;i2 < tierBands.length; i2++) {
    const band = tierBands[i2];
    const fill = i2 % 2 === 0 ? "var(--band-even)" : "var(--band-odd)";
    lines.push(`  <rect data-tier="${esc(band.tier)}" x="0" y="${band.y}" width="${SVG_W}" height="${TIER_H}" fill="${fill}" rx="0"/>`);
    lines.push(`  <text x="8" y="${band.y + 18}" font-size="11" fill="var(--tier-label)" font-family="system-ui,sans-serif" font-weight="600">${esc(band.label)}</text>`);
  }
  for (const edge of edges) {
    const src = positions.get(String(edge.source));
    const tgt = positions.get(String(edge.target));
    if (!src || !tgt)
      continue;
    const cls = String(edge.classification ?? "unproven");
    const style = EDGE_STYLE[cls] ?? EDGE_STYLE.unproven;
    const { x: sx, y: sy } = src;
    const { x: tx, y: ty } = tgt;
    const midy = (sy + ty) / 2;
    const pathD = `M ${sx},${sy} C ${sx},${midy} ${tx},${midy} ${tx},${ty}`;
    const dashAttr = style.dasharray ? ` stroke-dasharray="${style.dasharray}"` : "";
    lines.push(`  <path class="edge edge-${esc(cls)}" data-classification="${esc(cls)}" ` + `data-kind="${esc(edge.kind)}" ` + `d="${pathD}" fill="none" stroke="${style.stroke}"${dashAttr} ` + `stroke-width="${style.width}" opacity="${style.opacity}">` + `<title>${esc(edge.kind)}: ${esc(edge.source)} \u2192 ${esc(edge.target)} [${esc(cls)}]</title>` + `</path>`);
  }
  for (const node of nodes) {
    const pos = positions.get(String(node.id));
    if (!pos)
      continue;
    const x = pos.x - NODE_W / 2;
    const y = pos.y - NODE_H / 2;
    const label = shortLabel(node);
    const nodeType = String(node.type ?? "unknown");
    const nodeId = String(node.id);
    const isFrontier = frontierIds?.has(nodeId) ?? false;
    const blockers2 = blockerChains?.get(nodeId);
    const hasBlockers = (blockers2?.length ?? 0) > 0;
    const extraClass = isFrontier ? " node-frontier" : hasBlockers ? " node-blocked" : "";
    const frontierAttr = isFrontier ? ' data-frontier="true"' : "";
    const blockersAttr = hasBlockers ? ` data-blockers="${esc(blockers2.slice().sort().join(","))}"` : "";
    const frontierRing = isFrontier ? `<rect x="${x - 3}" y="${y - 3}" width="${NODE_W + 6}" height="${NODE_H + 6}" rx="8" ` + `fill="none" stroke="#f59e0b" stroke-width="2.5" class="frontier-ring"/>` : "";
    const titleExtra = isFrontier ? " | READY \u2014 actionable now" : hasBlockers ? ` | Blocked by: ${blockers2.slice().sort().join(", ")}` : "";
    lines.push(`  <g class="node node-${esc(nodeType)}${extraClass}" data-type="${esc(nodeType)}" ` + `data-id="${esc(nodeId)}"${frontierAttr}${blockersAttr}>` + frontierRing + `<rect x="${x}" y="${y}" width="${NODE_W}" height="${NODE_H}" rx="6" ` + `fill="var(--node-fill)" stroke="var(--node-stroke-${esc(nodeType.replace("-", "_"))})" stroke-width="1.5"/>` + `<text x="${pos.x}" y="${pos.y + 4}" text-anchor="middle" font-size="11" font-family="system-ui,sans-serif" ` + `fill="var(--node-text)" clip-path="url(#clip-${esc(nodeId.replace(/[^a-z0-9]/gi, "_"))})">${esc(label.length > 18 ? label.slice(0, 17) + "\u2026" : label)}</text>` + `<title>${esc(nodeType)}: ${esc(nodeId)}${titleExtra}</title>` + `</g>`);
  }
  lines.push(`</svg>`);
  return lines.join(`
`);
}
function renderNeedsYou(edges, nodes) {
  const needsYouClasses = new Set(["unproven", "stale", "missing"]);
  const nodeById = new Map(nodes.map((n) => [String(n.id), n]));
  const items = edges.filter((e) => needsYouClasses.has(e.classification));
  if (items.length === 0) {
    return `<section class="needs-you">
<h2>Needs You</h2>
<p class="all-good">All traceability links are proven. No action required.</p>
</section>`;
  }
  const rows = items.map((e) => {
    const srcNode = nodeById.get(String(e.source));
    const tgtNode = nodeById.get(String(e.target));
    const srcLabel = srcNode ? shortLabel(srcNode) : esc(String(e.source));
    const tgtLabel = tgtNode ? shortLabel(tgtNode) : esc(String(e.target));
    const cls = String(e.classification);
    return `  <li class="needs-item needs-${esc(cls)}">` + `<span class="badge-cls badge-${esc(cls)}">${esc(cls)}</span> ` + `<span class="edge-kind">${esc(e.kind)}</span> ` + `<span class="node-ref">${esc(srcLabel)}</span>` + ` \u2192 ` + `<span class="node-ref">${esc(tgtLabel)}</span>` + `</li>`;
  });
  return `<section class="needs-you">
<h2>Needs You <span class="count">(${items.length})</span></h2>
<ul class="needs-list">
${rows.join(`
`)}
</ul>
</section>`;
}
function renderWaveStatus(nodes, frontierIds, blockerChains) {
  const sliceNodes = nodes.filter((n) => String(n.type ?? "") === "slice");
  if (sliceNodes.length === 0)
    return "";
  const frontierItems = sliceNodes.filter((n) => frontierIds?.has(String(n.id)));
  const blockedItems = sliceNodes.filter((n) => {
    const ch = blockerChains?.get(String(n.id));
    return ch && ch.length > 0;
  });
  if (frontierItems.length === 0 && blockedItems.length === 0)
    return "";
  const parts = [];
  if (frontierItems.length > 0) {
    const rows = frontierItems.map((n) => `  <li class="frontier-item">` + `<span class="badge-frontier">READY</span> ` + `<span class="node-ref">${esc(shortLabel(n))}</span>` + `</li>`);
    parts.push(`<div class="frontier-section">
` + `<h3>Ready Now <span class="count">(${frontierItems.length})</span></h3>
` + `<ul class="frontier-list">
${rows.join(`
`)}
</ul>
</div>`);
  }
  if (blockedItems.length > 0) {
    const rows = blockedItems.map((n) => {
      const ch = blockerChains.get(String(n.id));
      const blockerList = ch.slice().sort().join(", ");
      return `  <li class="blocked-item">` + `<span class="node-ref">${esc(shortLabel(n))}</span>` + ` \u2190 blocked by: ` + `<span class="blockers-list">${esc(blockerList)}</span>` + `</li>`;
    });
    parts.push(`<div class="blocked-chains-section">
` + `<h3>Blocked Chains <span class="count">(${blockedItems.length})</span></h3>
` + `<ul class="blocked-list">
${rows.join(`
`)}
</ul>
</div>`);
  }
  return `<section class="wave-status">
<h2>Wave Status</h2>
${parts.join(`
`)}
</section>`;
}
function renderLegend() {
  const items = [
    { cls: "proven", label: "Proven \u2014 APPROVE gate or passing verify with fresh evidence", stroke: "#22c55e", dash: null },
    { cls: "unproven", label: "Unproven \u2014 no recorded verdict yet", stroke: "#d97706", dash: "5,4" },
    { cls: "stale", label: "Stale \u2014 evidence build-hash mismatch (regen detected)", stroke: "#ef4444", dash: "8,3,2,3" },
    { cls: "missing", label: "Missing \u2014 required link absent (spec-req with no slice)", stroke: "#dc2626", dash: "3,5" }
  ];
  const swatches = items.map((item) => {
    const svgLine = item.dash ? `<line x1="0" y1="8" x2="40" y2="8" stroke="${item.stroke}" stroke-width="2" stroke-dasharray="${item.dash}"/>` : `<line x1="0" y1="8" x2="40" y2="8" stroke="${item.stroke}" stroke-width="2"/>`;
    return `<div class="legend-item">
  <svg width="40" height="16" viewBox="0 0 40 16" aria-hidden="true">${svgLine}</svg>
  <span>${esc(item.label)}</span>
</div>`;
  }).join(`
`);
  return `<section class="legend">
<h3>Legend</h3>
${swatches}
</section>`;
}
var CSS = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg: #ffffff;
  --surface: #f8fafc;
  --border: #e2e8f0;
  --text: #1e293b;
  --text-muted: #64748b;
  --tier-label: #475569;
  --band-even: rgba(241,245,249,0.8);
  --band-odd: rgba(248,250,252,0.6);
  --node-fill: #ffffff;
  --node-text: #1e293b;
  --node-stroke-objective: #6366f1;
  --node-stroke-spec_requirement: #8b5cf6;
  --node-stroke-slice: #3b82f6;
  --node-stroke-self_test: #06b6d4;
  --node-stroke-live_verify: #10b981;
  --node-stroke-gate: #f59e0b;
  --node-stroke-artifact_evidence: #94a3b8;
  --accent: #6366f1;
  --needs-bg: #fff7ed;
  --needs-border: #fed7aa;
  --proven-bg: #f0fdf4;
  --proven-border: #86efac;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #0f172a;
    --surface: #1e293b;
    --border: #334155;
    --text: #f1f5f9;
    --text-muted: #94a3b8;
    --tier-label: #94a3b8;
    --band-even: rgba(30,41,59,0.8);
    --band-odd: rgba(15,23,42,0.6);
    --node-fill: #1e293b;
    --node-text: #f1f5f9;
    --needs-bg: #1c1007;
    --needs-border: #92400e;
    --proven-bg: #052e16;
    --proven-border: #166534;
  }
}
:root[data-theme="dark"] {
  --bg: #0f172a;
  --surface: #1e293b;
  --border: #334155;
  --text: #f1f5f9;
  --text-muted: #94a3b8;
  --tier-label: #94a3b8;
  --band-even: rgba(30,41,59,0.8);
  --band-odd: rgba(15,23,42,0.6);
  --node-fill: #1e293b;
  --node-text: #f1f5f9;
  --needs-bg: #1c1007;
  --needs-border: #92400e;
  --proven-bg: #052e16;
  --proven-border: #166534;
}

body {
  background: var(--bg);
  color: var(--text);
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  padding: 24px;
}

h1 { font-size: 1.5rem; font-weight: 700; margin-bottom: 4px; }
h2 { font-size: 1.1rem; font-weight: 600; margin-bottom: 12px; }
h3 { font-size: 0.9rem; font-weight: 600; margin-bottom: 8px; }

.subtitle { color: var(--text-muted); margin-bottom: 20px; font-size: 0.85rem; }

.chart-wrap {
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  margin-bottom: 24px;
  padding: 8px;
}

.legend {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  padding: 14px 18px;
  margin-bottom: 24px;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: flex-start;
}

.legend h3 { width: 100%; margin-bottom: 4px; }

.legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.8rem;
  color: var(--text-muted);
}

.needs-you {
  border: 1px solid var(--needs-border);
  border-radius: 8px;
  background: var(--needs-bg);
  padding: 16px 20px;
  margin-bottom: 24px;
}

.needs-you.all-proven {
  border-color: var(--proven-border);
  background: var(--proven-bg);
}

.count {
  font-weight: 400;
  color: var(--text-muted);
  font-size: 0.9em;
}

.all-good { color: #16a34a; font-weight: 500; }

.needs-list { list-style: none; display: flex; flex-direction: column; gap: 6px; }

.needs-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.85rem;
  padding: 5px 10px;
  border-radius: 5px;
  background: rgba(0,0,0,0.04);
}

.badge-cls {
  font-size: 0.7rem;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 4px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  min-width: 64px;
  text-align: center;
}

.badge-unproven { background: #fef3c7; color: #92400e; }
.badge-stale    { background: #fee2e2; color: #991b1b; }
.badge-missing  { background: #fce7f3; color: #9d174d; }

.edge-kind {
  font-family: 'Menlo', 'Courier New', monospace;
  font-size: 0.75rem;
  color: var(--text-muted);
  background: rgba(0,0,0,0.06);
  padding: 1px 5px;
  border-radius: 3px;
}

.node-ref {
  font-family: 'Menlo', 'Courier New', monospace;
  font-size: 0.8rem;
}

.stat-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 24px;
}

.stat-card {
  flex: 1;
  min-width: 100px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  padding: 10px 14px;
  text-align: center;
}

.stat-card .num { font-size: 1.6rem; font-weight: 700; }
.stat-card .lbl { font-size: 0.75rem; color: var(--text-muted); }
.stat-proven  .num { color: #22c55e; }
.stat-unproven .num { color: #d97706; }
.stat-stale   .num { color: #ef4444; }
.stat-missing .num { color: #dc2626; }

/* \u2500\u2500 frontier / blocked node markers \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
.node-frontier .frontier-ring { animation: frontier-pulse 2s ease-in-out infinite; }
@keyframes frontier-pulse {
  0%, 100% { opacity: 0.9; }
  50%       { opacity: 0.4; }
}

.node-blocked rect:not([class]) { opacity: 0.6; }

/* \u2500\u2500 wave-status section \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
.wave-status {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  padding: 16px 20px;
  margin-bottom: 24px;
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
}
.wave-status h2 { width: 100%; margin-bottom: 0; }

.frontier-section, .blocked-chains-section { flex: 1; min-width: 200px; }

.frontier-list, .blocked-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 8px;
}

.frontier-item, .blocked-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.85rem;
  padding: 4px 8px;
  border-radius: 4px;
  background: rgba(0,0,0,0.03);
}

.badge-frontier {
  font-size: 0.7rem;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 4px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  background: #fef9c3;
  color: #854d0e;
  border: 1px solid #fde047;
}

.blockers-list {
  font-family: 'Menlo', 'Courier New', monospace;
  font-size: 0.75rem;
  color: var(--text-muted);
}
`;
function renderTraceHtml(classifiedGraph, slug = "") {
  const nodes = Array.isArray(classifiedGraph?.nodes) ? classifiedGraph.nodes : [];
  const edges = Array.isArray(classifiedGraph?.edges) ? classifiedGraph.edges : [];
  const { positions, tierBands, svgH, frontierIds, blockerChains } = computeLayout(nodes, edges);
  const svgMarkup = renderSvg(nodes, edges, positions, tierBands, svgH, frontierIds, blockerChains);
  const waveStatus = renderWaveStatus(nodes, frontierIds, blockerChains);
  const needsYou = renderNeedsYou(edges, nodes);
  const legend = renderLegend();
  const counts = { proven: 0, unproven: 0, stale: 0, missing: 0 };
  for (const e of edges) {
    const c = e.classification;
    if (c in counts)
      counts[c]++;
  }
  const total = edges.length;
  const pct = total > 0 ? Math.round(counts.proven / total * 100) : 0;
  const statsHtml = `<div class="stat-row">
  <div class="stat-card stat-proven"><div class="num">${counts.proven}</div><div class="lbl">proven</div></div>
  <div class="stat-card stat-unproven"><div class="num">${counts.unproven}</div><div class="lbl">unproven</div></div>
  <div class="stat-card stat-stale"><div class="num">${counts.stale}</div><div class="lbl">stale</div></div>
  <div class="stat-card stat-missing"><div class="num">${counts.missing}</div><div class="lbl">missing</div></div>
  <div class="stat-card"><div class="num">${pct}%</div><div class="lbl">coverage</div></div>
</div>`;
  const titleSlug = slug ? ` \u2014 ${slug}` : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Traceability${titleSlug}</title>
<style>${CSS}</style>
</head>
<body>
<h1>Traceability Chain${titleSlug}</h1>
<p class="subtitle">${nodes.length} nodes &middot; ${edges.length} edges &middot; ${tierBands.length} active tiers</p>
${statsHtml}
${legend}
<div class="chart-wrap">
${svgMarkup}
</div>
${waveStatus}
${needsYou}
</body>
</html>`;
}
function regenerateMotiveTraceHtml(projectDir, slug) {
  if (!projectDir || !slug)
    return;
  _generate2(projectDir, slug).catch((err) => {
    process.stderr.write(`[traceability-ambient] warn: failed to regenerate TRACE.html for "${slug}": ${err?.message ?? err}
`);
  });
}
async function _generate2(projectDir, slug) {
  const motiveDir = join4(projectDir, ".groundwork", "motives", slug);
  if (!existsSync7(motiveDir))
    return;
  const { NativeSpineAdapter: NativeSpineAdapter2 } = await Promise.resolve().then(() => (init_traceability_adapter(), exports_traceability_adapter));
  const adapter = new NativeSpineAdapter2({ projectDir, slug });
  const graph = buildTraceabilityGraph(adapter);
  const classified = classifyTraceabilityGraph(graph, []);
  const html = renderTraceHtml(classified, slug);
  const outPath = join4(motiveDir, "TRACE.html");
  writeFileSync5(outPath, html, "utf8");
}

// hooks/ledger.mjs
function resolveSessionId(flags) {
  return flags?.session || process.env.CLAUDE_CODE_SESSION_ID || undefined;
}
var _ledgerPath = null;
function ledgerPath() {
  return _ledgerPath;
}
function _tryRefreshMap(projectDir) {
  try {
    const ledger = readLedger(ledgerPath());
    if (ledger?.motive) {
      regenerateMotiveMap(projectDir, ledger.motive);
      regenerateMotiveTraceHtml(projectDir, ledger.motive);
    }
  } catch {}
}
function die(msg, code = 1) {
  process.stderr.write(`ledger: ${msg}
`);
  process.exit(code);
}
function parseFlags(args) {
  const flags = {};
  const positionals = [];
  for (let i2 = 0;i2 < args.length; i2++) {
    const a = args[i2];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = args[i2 + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i2++;
      } else {
        flags[key] = true;
      }
    } else {
      positionals.push(a);
    }
  }
  return { flags, positionals };
}
var SYMBOL = { complete: "\u2713", in_progress: "\u22EF", pending: "\xB7" };
var VALID_STATUSES = new Set(["pending", "in_progress", "complete", "skipped"]);
var VALID_KINDS = new Set(["plan", "diagnose", "design", "impl", "fog"]);
var KIND_LABEL = { plan: "\uD83D\uDCCB plan", diagnose: "\uD83D\uDD0D diagnose", design: "\uD83C\uDFA8 design", impl: "\u2699 impl", fog: "\uD83C\uDF2B fog" };
function assertKind(val) {
  if (!VALID_KINDS.has(val))
    die(`invalid kind "${val}". Must be: plan | diagnose | design | impl | fog`, 2);
}
function advisorVerdict(gate) {
  const a = gate?.advisor;
  if (typeof a === "string")
    return a;
  if (a && typeof a === "object" && a.verdict != null)
    return String(a.verdict);
  return "pending";
}
function assertStatus(val) {
  if (!VALID_STATUSES.has(val))
    die(`invalid status "${val}". Must be: pending | in_progress | complete | skipped`, 2);
}
var VALID_TICKET_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
function assertTicket(val) {
  if (!VALID_TICKET_RE.test(val)) {
    die(`invalid ticket id "${val}". Must be a bare id (e.g. "t1", "my-ticket") \u2014 no path separators or .md suffix.`, 2);
  }
}
function _loadMotiveFold(projectDir, motiveId) {
  if (!motiveId)
    return null;
  const journalDir = path7.join(projectDir, ".groundwork", "journal");
  if (!existsSync8(journalDir))
    return null;
  try {
    const allEvents = readAllEvents(journalDir);
    const { shown: motiveEvents } = filterEvents(allEvents, { motive: motiveId });
    if (motiveEvents.length === 0)
      return null;
    return assembleGraphFold(motiveEvents);
  } catch {
    return null;
  }
}
function _loadCharterAcIds(projectDir, motiveId) {
  if (!motiveId || !projectDir)
    return new Set;
  const motivePath = path7.join(projectDir, ".groundwork", "motives", motiveId, "motive.md");
  if (!existsSync8(motivePath))
    return new Set;
  try {
    const content = readFileSync10(motivePath, "utf8");
    const headingMatch = content.match(/^## Acceptance criteria[^\n]*/m);
    if (!headingMatch)
      return new Set;
    const afterHeading = content.slice(headingMatch.index + headingMatch[0].length);
    const nextHeadingIdx = afterHeading.search(/^## /m);
    const section = nextHeadingIdx === -1 ? afterHeading : afterHeading.slice(0, nextHeadingIdx);
    const ids = new Set;
    for (const line of section.split(`
`)) {
      const m = line.match(/^- (\S+):/);
      if (m)
        ids.add(m[1]);
    }
    return ids;
  } catch {
    return new Set;
  }
}
function _assertFoldRefs(fold, rawIds, fieldName, nodeType, idPrefix) {
  if (!fold || !rawIds || rawIds.length === 0)
    return;
  const prefixedIds = rawIds.map((id) => `${idPrefix}${id}`);
  const { missing } = validateFoldRefs(fold, prefixedIds, nodeType);
  if (missing.length === 0)
    return;
  for (const prefixedId of missing) {
    const rawId = prefixedId.slice(idPrefix.length);
    process.stderr.write(`ledger error [MOTIVE-DAG-R-008]: ${fieldName} references unknown id "${rawId}" \u2014 not found in motive canonical fold
`);
  }
  process.exit(1);
}
var VALID_DECISION_RE = /^D-\d+$/;
function warnDecisions(ids) {
  for (const id of ids) {
    if (!VALID_DECISION_RE.test(id)) {
      process.stderr.write(`warning: decision id "${id}" does not match expected format D-<n> (e.g. "D-40")
`);
    }
  }
}
var KNOWN_SLICE_KEYS = new Set([
  "id",
  "status",
  "wave",
  "kind",
  "desc",
  "blocked_by",
  "depends_on",
  "acceptance",
  "name",
  "claimed_by",
  "claimed_at",
  "created_by",
  "covers_ac",
  "ticket",
  "decisions"
]);
function levenshtein(a, b) {
  if (Math.abs(a.length - b.length) > 3)
    return 4;
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i2) => Array(n + 1).fill(0).map((_2, j) => i2 === 0 ? j : j === 0 ? i2 : 0));
  for (let i2 = 1;i2 <= m; i2++) {
    for (let j = 1;j <= n; j++) {
      dp[i2][j] = a[i2 - 1] === b[j - 1] ? dp[i2 - 1][j - 1] : 1 + Math.min(dp[i2 - 1][j], dp[i2][j - 1], dp[i2 - 1][j - 1]);
    }
  }
  return dp[m][n];
}
function validateLedgerDoc(ledger, { strictSchema = false } = {}) {
  const errors = [];
  const warnings = [];
  if (ledger == null || typeof ledger !== "object") {
    errors.push("ledger: not an object");
    return { errors, warnings };
  }
  try {
    const validate = loadSchema("run-ledger");
    if (!validate(ledger) && validate.errors) {
      for (const line of ajvErrorsToLines(validate.errors, "ledger")) {
        if (strictSchema) {
          errors.push(line);
        } else {
          warnings.push(line);
        }
      }
    }
  } catch (e) {
    warnings.push(`schema: could not load run-ledger schema (${e?.message ?? e})`);
  }
  const slices = Array.isArray(ledger.slices) ? ledger.slices : [];
  const sliceIdCounts = new Map;
  for (const s of slices) {
    if (!s?.id)
      continue;
    sliceIdCounts.set(s.id, (sliceIdCounts.get(s.id) ?? 0) + 1);
  }
  for (const [id, count] of sliceIdCounts) {
    if (count > 1)
      errors.push(`slice "${id}": duplicate id appears ${count} times`);
  }
  const sliceIds = new Set(slices.map((s) => s?.id).filter(Boolean));
  for (const s of slices) {
    if (!s || typeof s !== "object")
      continue;
    const sid = s.id ?? "?";
    for (const field of ["blocked_by", "depends_on"]) {
      if (!Array.isArray(s[field]))
        continue;
      for (const ref of s[field]) {
        if (typeof ref === "string" && ref && !sliceIds.has(ref)) {
          errors.push(`slice "${sid}": ${field} references unknown id "${ref}"`);
        }
      }
    }
    if (Object.prototype.hasOwnProperty.call(s, "acceptance")) {
      const acc = s.acceptance;
      if (!Array.isArray(acc) || acc.length === 0) {
        errors.push(`slice "${sid}": acceptance must be a non-empty array when present (omit the key to indicate no criteria)`);
      } else if (acc.some((item) => typeof item !== "string" || item.trim() === "")) {
        errors.push(`slice "${sid}": acceptance items must be non-empty strings`);
      }
    }
    for (const key of Object.keys(s)) {
      if (KNOWN_SLICE_KEYS.has(key))
        continue;
      let best = null, bestDist = 3;
      for (const known of KNOWN_SLICE_KEYS) {
        const d = levenshtein(key, known);
        if (d < bestDist) {
          best = known;
          bestDist = d;
        }
      }
      if (best !== null) {
        warnings.push(`slice "${sid}": unknown key "${key}" \u2014 did you mean "${best}"? (possible typo; field will be ignored)`);
      }
    }
    if (typeof s.wave === "number" && s.wave > 0 && !(Array.isArray(s.blocked_by) && s.blocked_by.length > 0) && !(Array.isArray(s.depends_on) && s.depends_on.length > 0)) {
      warnings.push(`slice "${sid}": wave ${s.wave} has no blockers \u2014 treated as a root; pass --blocked-by if it depends on earlier slices`);
    }
  }
  const sliceById = new Map(slices.map((s) => [s?.id, s]));
  for (const s of slices) {
    if (!s || typeof s !== "object")
      continue;
    const sid = s.id ?? "?";
    const sWave = s.wave;
    for (const field of ["blocked_by", "depends_on"]) {
      if (!Array.isArray(s[field]))
        continue;
      for (const ref of s[field]) {
        if (typeof ref !== "string" || !ref)
          continue;
        const blocker = sliceById.get(ref);
        if (!blocker) {
          warnings.push(`slice "${sid}": ${field} "${ref}" \u2014 wave order cannot be verified (blocker not found in ledger)`);
          continue;
        }
        const bWave = blocker.wave;
        if (sWave == null || bWave == null) {
          continue;
        }
        if (bWave >= sWave) {
          warnings.push(`slice "${sid}" (wave ${sWave}): ${field} "${ref}" is in wave ${bWave} \u2014 blocker must be in a strictly earlier wave`);
        }
      }
    }
  }
  return { errors, warnings };
}
function warnValidate(ledger) {
  const { errors, warnings } = validateLedgerDoc(ledger);
  for (const w of warnings)
    process.stderr.write(`ledger warn: ${w}
`);
  for (const e of errors)
    process.stderr.write(`ledger warn: ${e}
`);
}
function checkLedger(ledger) {
  const { errors, warnings } = validateLedgerDoc(ledger);
  for (const w of warnings)
    process.stderr.write(`ledger warn: ${w}
`);
  if (errors.length) {
    const err = new Error(`ledger validation failed:
` + errors.map((x) => "  " + x).join(`
`));
    err.exitCode = 1;
    throw err;
  }
}
function checkLedgerStrict(ledger) {
  const { errors, warnings } = validateLedgerDoc(ledger, { strictSchema: true });
  for (const w of warnings)
    process.stderr.write(`ledger warn: ${w}
`);
  if (errors.length) {
    const err = new Error(`ledger validation failed:
` + errors.map((x) => "  " + x).join(`
`));
    err.exitCode = 1;
    throw err;
  }
}
function mutateLedgerChecked(lPath, fn) {
  return mutateLedger(lPath, (l) => {
    const result = fn(l);
    const next = result === undefined ? l : result;
    if (next != null)
      checkLedger(next);
    return result;
  });
}
function reSeal(ledger, projectDir) {
  const sid = ledger?.session_id;
  const kp = keyPath({ projectDir, sessionId: sid });
  const isSealed = ledger?.gate?.seal != null;
  if (!isSealed && !existsSync8(kp))
    return;
  const key = readKey({ projectDir, sessionId: sid });
  ledger.gate = ledger.gate ?? {};
  ledger.gate.seal = computeSeal(canonicalReleaseState(ledger), key);
}
function assertWriteToken(ledger, passedToken) {
  const stored = ledger?.write_token;
  if (!stored) {
    const e = new Error(`gate/complete/abandon require write_token authority \u2014 this ledger has none.
` + "  Re-initialize via `ledger init <file>` (embeds a token).");
    e.exitCode = 1;
    throw e;
  }
  if (!passedToken || passedToken !== stored) {
    const e = new Error(`gate/complete/abandon are orchestrator-only \u2014 pass --token <write_token> printed at init
` + "  (run `ledger status` to check run state; the token itself is never displayed)");
    e.exitCode = 1;
    throw e;
  }
}
function assertScopedOrWriteToken(ledger, passedToken, sliceIds) {
  const stored = ledger?.write_token;
  if (!stored) {
    const e = new Error(`complete requires write_token authority \u2014 this ledger has none.
` + "  Re-initialize via `ledger init <file>` (embeds a token).");
    e.exitCode = 1;
    throw e;
  }
  if (passedToken && passedToken === stored)
    return null;
  const scopedTokens = Array.isArray(ledger.scoped_tokens) ? ledger.scoped_tokens : [];
  const entry = passedToken ? scopedTokens.find((st) => st?.token && st.token === passedToken) : undefined;
  if (!entry) {
    const e = new Error(`complete requires the orchestrator write_token or a valid scoped token.
` + `  Orchestrator: pass --token <write_token> printed at init.
` + "  Junior orchestrator: pass --token <scoped_token> issued by `ledger scope-token <scope> --token <write_token>`.");
    e.exitCode = 1;
    throw e;
  }
  const scope = entry.scope;
  const slices = Array.isArray(ledger.slices) ? ledger.slices : [];
  const byId = new Map(slices.map((s) => [s?.id, s]));
  for (const id of sliceIds) {
    const s = byId.get(id);
    if (!s)
      continue;
    if (!s.created_by) {
      const e = new Error(`scoped token for "${scope}" cannot complete slice "${id}": no created_by set.
` + "  Set --created-by when adding the slice, or use the orchestrator write_token.");
      e.exitCode = 1;
      throw e;
    }
    if (s.created_by !== scope) {
      const e = new Error(`scoped token for "${scope}" cannot complete slice "${id}": owned by "${s.created_by}".`);
      e.exitCode = 1;
      throw e;
    }
  }
  return scope;
}
var HELP = {
  status: {
    summary: "compact one-line-per-slice view of the current run",
    usage: "ledger status",
    flags: []
  },
  complete: {
    summary: "mark one or more slices complete (sugar for set --status complete)",
    usage: "ledger complete <id> [<id> ...] [--token <write_token>]",
    flags: [
      "--token <t>          write-token printed at init (required unless ledger is token-free)"
    ]
  },
  gate: {
    summary: "set a gate verdict (advisor | verifier | qa)",
    usage: "ledger gate <advisor|verifier|qa> <verdict> [flags]",
    flags: [
      "--token <t>          write-token printed at init (required unless ledger is token-free)",
      "--citation <text>    (advisor) citation string stored with verdict",
      "--rubric <text>      (advisor) rubric string stored with verdict",
      "--axes-correctness N (advisor) 0-3 axis score",
      "--axes-completeness N",
      "--axes-over_engineering N",
      "--axes-contract-fitness N (advisor) 0-3, or omit if N/A",
      "--axes-plan-soundness N"
    ]
  },
  abandon: {
    summary: "set active:false \u2014 releases the stop-gate for the current run",
    usage: "ledger abandon [--session <id>] [--token <write_token>]",
    flags: [
      "--session <id>   override session id (default: CLAUDE_CODE_SESSION_ID env)",
      "--token <t>      write-token printed at init (required for sealed runs)"
    ]
  },
  init: {
    summary: "write the initial ledger atomically from a JSON file or stdin",
    usage: "ledger init <file|-> [--motive <id>] [--token <existing-token>]",
    flags: [
      "--motive <id>        motive id to stamp on the ledger (overrides JSON input)",
      "--token <t>          write-token of the existing active run (required to overwrite a live run)"
    ]
  },
  add: {
    summary: "insert a new slice into the ledger",
    usage: "ledger add <id> [flags]",
    flags: [
      "--wave N             wave number (default 0)",
      '--desc "\u2026"           human description (default "")',
      "--kind <k>           plan | diagnose | design | impl (default impl)",
      "--status <s>         pending | in_progress | complete | skipped (default pending)",
      "--blocked-by a,b,c  comma-separated list of blocking slice ids",
      '--acceptance "a;b"  semicolon-separated acceptance criteria strings',
      "--ticket <tid>      ticket document id or path this slice is scoped to",
      '--covers-ac "a,b"   comma-separated AC labels this slice covers (drives AC_COVERAGE on complete)',
      '--decisions "D-1"   comma-separated decision ids this slice is constrained by',
      "--claimed-by <sid>  (optional) set claimed_by on the new slice",
      "--created-by <scope> agent/scope identifier that owns this slice"
    ]
  },
  "scope-token": {
    summary: "issue a scoped token authorizing a junior-orchestrator to complete its own slices",
    usage: "ledger scope-token <scope> --token <write_token>",
    flags: [
      "--token <t>   orchestrator write-token (required \u2014 issuance is orchestrator-only)"
    ]
  },
  "await-human": {
    summary: "set or clear the awaiting-human hold (silences the stop-gate while paused for a human decision)",
    usage: "ledger await-human [clear] --token <write_token>",
    flags: [
      'clear         positional \u2014 pass "clear" as the first argument to release the hold',
      "--token <t>   orchestrator write-token (required \u2014 hold is orchestrator-only)"
    ]
  },
  "milestone-signoff": {
    summary: "record a human sign-off on the current milestone (policy=milestone only; SECURITY: requires write_token)",
    usage: "ledger milestone-signoff --verdict APPROVE|REJECT --verified-by <name> --token <write_token>",
    flags: [
      "--verdict APPROVE|REJECT    required \u2014 APPROVE releases the pacing gate; REJECT holds it",
      "--verified-by <name>        required \u2014 identity of the human signer",
      '--note "\u2026"                  optional \u2014 remediation note (recommended for REJECT)',
      "--build-hash <hash>         optional \u2014 current build hash; artifacts with a different captured_build_hash are rejected as stale",
      "--token <t>                 orchestrator write-token (required \u2014 sign-off is orchestrator-only; subagents must not self-sign)"
    ]
  },
  rm: {
    summary: "remove one or more slices from the ledger",
    usage: "ledger rm <id> [<id> ...]",
    flags: []
  },
  set: {
    summary: "update fields on an existing slice (only provided fields change)",
    usage: "ledger set <id> [flags]",
    flags: [
      "--status <s>         pending | in_progress | complete",
      "--wave N             new wave number",
      '--desc "\u2026"           new description',
      "--blocked-by a,b,c  comma-separated list of blocking slice ids",
      '--acceptance "a;b"  semicolon-separated acceptance criteria strings',
      "--ticket <tid>      ticket document id or path this slice is scoped to",
      '--covers-ac "a,b"   comma-separated AC labels this slice covers (drives AC_COVERAGE on complete)',
      '--decisions "D-1"   comma-separated decision ids this slice is constrained by',
      "--claimed-by <sid>  set claimed_by on the slice"
    ]
  },
  claim: {
    summary: "claim one or more slices for the current session (no --token required)",
    usage: "ledger claim <id> [<id> ...] [--json] [--strict]",
    flags: [
      "--session <id>   override session id (default: CLAUDE_CODE_SESSION_ID env)",
      "--json           print JSON result to stdout: {claimed, refused, ok} (ok=false on any refusal)",
      "--strict         exit non-zero when any id was refused (default: always exit 0)"
    ]
  },
  show: {
    summary: "print all fields of one slice in a readable form",
    usage: "ledger show <id>",
    flags: []
  },
  view: {
    summary: "render run.json as a human-readable markdown table grouped by wave/status",
    usage: "ledger view",
    flags: []
  },
  fog: {
    summary: "add an open-question (fog) slice with no acceptance criteria required",
    usage: 'ledger fog <id> --desc "\u2026" --question "\u2026" [--wave N]',
    flags: [
      '--desc "\u2026"       human description (required)',
      '--question "\u2026"   the open question being tracked (required)',
      "--wave N         wave number (default 0)"
    ]
  },
  frontier: {
    summary: "print slices a session can start right now (pending/open, unblocked, unclaimed or same session)",
    usage: "ledger frontier [--session <id>]",
    flags: [
      "--session <id>   override session id (default: CLAUDE_CODE_SESSION_ID env)"
    ]
  },
  autopilot: {
    summary: "extend session pacing budget by N units (requires write-token authority)",
    usage: 'ledger autopilot --range N --token <write_token> --reason "..."',
    flags: [
      "--range N        number of additional units to grant (required, \u22651)",
      "--token <t>      write-token printed at init (required if ledger has write_token)",
      '--reason "..."   human-readable rationale for the grant (required, must be non-empty)'
    ]
  }
};
function cmdHelp(args) {
  if (args.length) {
    const cmd = args[0];
    const h = HELP[cmd];
    if (!h)
      die(`unknown command "${cmd}". Run ledger help for a list.`, 2);
    const lines = [`Usage: ${h.usage}`, `  ${h.summary}`];
    if (h.flags.length) {
      lines.push("", "Flags:");
      h.flags.forEach((f) => lines.push(`  ${f}`));
    }
    process.stdout.write(lines.join(`
`) + `
`);
    return;
  }
  const cmds = Object.entries(HELP).map(([name, h]) => `  ${name.padEnd(10)} ${h.summary}`).join(`
`);
  process.stdout.write([
    "Usage: ledger <command> [args] [flags]",
    "",
    "Commands:",
    cmds,
    "",
    "Run `ledger help <command>` or `ledger <command> --help` for per-command details.",
    "Exit codes: 0 success  1 operational failure  2 usage error"
  ].join(`
`) + `
`);
}
function cmdStatus() {
  const l = readLedger(ledgerPath());
  if (!l)
    die("no ledger at " + ledgerPath(), 1);
  warnValidate(l);
  const slices = Array.isArray(l.slices) ? l.slices : [];
  const done = slices.filter((s) => s?.status === "complete").length;
  const head = `run: ${l.brief ?? "(no brief)"}${l.active === false ? "  [ABANDONED]" : ""}`;
  const rows = slices.map((s) => {
    const sym = SYMBOL[s?.status] ?? `?${s?.status ?? ""}`;
    const dep = Array.isArray(s?.blocked_by) && s.blocked_by.length ? ` \u27F5${s.blocked_by.join(",")}` : "";
    const wave = s?.wave != null ? `w${s.wave}` : "";
    const claim = s?.claimed_by ? ` [claimed:${s.claimed_by}]` : "";
    return `${s?.id ?? "?"}${sym}${wave ? " " + wave : ""}${dep}${claim}`;
  });
  const gate = l.gate ?? {};
  process.stdout.write(`${head}
${rows.join("  ")}
` + `gate: advisor=${advisorVerdict(gate)}
` + `${done}/${slices.length} slices complete
`);
}
function cmdComplete(args) {
  const { flags, positionals: ids } = parseFlags(args);
  if (!ids.length)
    die("usage: ledger complete <id> [<id> ...] [--token <write_token>]", 2);
  let done = 0;
  let total = 0;
  const missing = [];
  let capturedLedger = null;
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  mutateLedgerChecked(ledgerPath(), (l) => {
    if (!l)
      throw new Error("no ledger to update");
    assertScopedOrWriteToken(l, flags.token, ids);
    capturedLedger = l;
    const slices = Array.isArray(l.slices) ? l.slices : [];
    const byId = new Map(slices.map((s) => [s?.id, s]));
    const now = new Date().toISOString();
    for (const id of ids) {
      const s = byId.get(id);
      if (!s)
        missing.push(id);
      else {
        s.status = "complete";
        s.completed_at = now;
        s.session_id = l.session_id ?? null;
        delete s.claimed_by;
        delete s.claimed_at;
      }
    }
    total = slices.length;
    done = slices.filter((s) => s?.status === "complete").length;
    reSeal(l, projectDir);
  });
  if (capturedLedger) {
    const sliceMap = new Map((capturedLedger.slices ?? []).map((s) => [s?.id, s]));
    for (const id of ids.filter((id2) => !missing.includes(id2))) {
      emitHookEvent({
        projectDir,
        sessionId: capturedLedger.session_id,
        type: "TASK_COMPLETE",
        source: "hook:ledger",
        data: { slice: id },
        ledger: capturedLedger
      });
      const slice = sliceMap.get(id);
      const raw = slice?.covers_ac;
      const acKeys = Array.isArray(raw) ? raw : raw != null ? [String(raw)] : [];
      for (const ac of acKeys) {
        emitHookEvent({
          projectDir,
          sessionId: capturedLedger.session_id,
          type: "AC_COVERAGE",
          source: "hook:ledger",
          data: { slice: id, ac },
          ledger: capturedLedger
        });
      }
    }
  }
  if (missing.length)
    die(`unknown slice id(s): ${missing.join(", ")}`, 2);
  _tryRefreshMap(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  process.stdout.write(`${ids.join(", ")} \u2713 (${done}/${total} complete)
`);
}
function cmdAwaitHuman(args) {
  const { flags, positionals } = parseFlags(args ?? []);
  const clearing = positionals[0] === "clear";
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  mutateLedgerChecked(ledgerPath(), (l) => {
    if (!l)
      throw new Error("no ledger to update");
    assertWriteToken(l, flags.token);
    if (clearing) {
      delete l.awaiting_human;
    } else {
      l.awaiting_human = true;
    }
    reSeal(l, projectDir);
  });
  if (clearing) {
    process.stdout.write(`awaiting-human hold cleared \u2014 normal gate enforcement resumes
`);
  } else {
    process.stdout.write(`awaiting-human hold set \u2014 stop-gate will not nag until the hold is cleared
`);
  }
}
function cmdMilestoneSignoff(args) {
  const { flags } = parseFlags(args ?? []);
  const verdict = flags.verdict;
  if (!verdict || !["APPROVE", "REJECT"].includes(verdict)) {
    die("milestone-signoff requires --verdict APPROVE|REJECT", 2);
  }
  const verifiedBy = flags["verified-by"];
  if (!verifiedBy) {
    die("milestone-signoff requires --verified-by <name>", 2);
  }
  const note = flags.note ?? undefined;
  const currentBuildHash = flags["build-hash"] ?? null;
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  mutateLedgerChecked(ledgerPath(), (l) => {
    if (!l)
      throw new Error("no ledger to update");
    assertWriteToken(l, flags.token);
    if (l.pacing?.policy !== "milestone") {
      const e = new Error(`milestone-signoff requires pacing.policy = "milestone". Current policy: ${l.pacing?.policy ?? "none"}.`);
      e.exitCode = 1;
      throw e;
    }
    if (verdict === "APPROVE") {
      const hashCheck = checkMilestoneArtifacts(l, currentBuildHash);
      if (!hashCheck.satisfied) {
        const e = new Error(`Milestone sign-off rejected: ${hashCheck.reason}
` + `Stale artifacts must be re-captured against the current build before an APPROVE can be recorded.
` + `Stale paths: ${hashCheck.staleArtifacts.join(", ")}`);
        e.exitCode = 1;
        throw e;
      }
      const artifacts2 = Array.isArray(l.pacing.milestone_artifacts) ? l.pacing.milestone_artifacts : [];
      for (const artifact of artifacts2) {
        if (artifact.kind !== "live_url" && artifact.path && !existsSync8(artifact.path)) {
          const e = new Error(`Milestone artifact not found on disk: ${artifact.path}
` + `Ensure the artifact exists before recording an APPROVE sign-off.`);
          e.exitCode = 1;
          throw e;
        }
      }
    }
    const artifacts = Array.isArray(l.pacing?.milestone_artifacts) ? l.pacing.milestone_artifacts : [];
    const artifactsVerified = artifacts.map((a) => a.path ?? "").filter(Boolean);
    if (!l.pacing)
      l.pacing = {};
    l.pacing.milestone_signoff = {
      verdict,
      verified_by: verifiedBy,
      verified_at: new Date().toISOString(),
      artifacts_verified: artifactsVerified,
      ...note !== undefined ? { note } : {}
    };
    reSeal(l, projectDir);
  });
  process.stdout.write(`milestone-signoff: ${verdict} by ${verifiedBy}
`);
}
function cmdScopeToken(args) {
  const { flags, positionals } = parseFlags(args);
  const scope = positionals[0];
  if (!scope)
    die("usage: ledger scope-token <scope> --token <write_token>", 2);
  let scopedToken = null;
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  mutateLedgerChecked(ledgerPath(), (l) => {
    if (!l)
      throw new Error("no ledger to update");
    assertWriteToken(l, flags.token);
    const tok = "sct_" + randomBytes2(8).toString("hex");
    if (!Array.isArray(l.scoped_tokens))
      l.scoped_tokens = [];
    l.scoped_tokens.push({ scope, token: tok });
    scopedToken = tok;
    reSeal(l, projectDir);
  });
  process.stdout.write(`scoped_token: ${scopedToken}
` + `  scope: ${scope}
` + `  (pass as --token to \`ledger complete\` for slices with created_by="${scope}")
`);
}
function cmdGate(args) {
  const { flags, positionals } = parseFlags(args);
  const [which, verdictRaw] = positionals;
  if (!which || !verdictRaw)
    die("usage: ledger gate <advisor|verifier|qa> <verdict> [--token <t>] [--citation .. --rubric ..]", 2);
  if (!["advisor", "verifier", "qa"].includes(which))
    die(`unknown gate "${which}"`, 2);
  const VALID_ADVISOR_VERDICTS = new Set(["APPROVE", "CORRECTION", "STOP", "GAPS", "REPLAN"]);
  if (which === "advisor" && !VALID_ADVISOR_VERDICTS.has(verdictRaw)) {
    die(`invalid advisor verdict "${verdictRaw}". Must be: APPROVE | CORRECTION | STOP | GAPS | REPLAN`, 1);
  }
  const AXIS_KEYS = ["correctness", "completeness", "over_engineering", "contract_fitness", "plan_soundness"];
  const hasAxes = AXIS_KEYS.some((k) => flags[`axes-${k}`] != null);
  const hasObj = which === "advisor" && (flags.citation || flags.rubric || hasAxes);
  let value;
  if (hasObj) {
    value = { verdict: verdictRaw };
    if (flags.rubric)
      value.rubric = flags.rubric;
    if (flags.citation)
      value.citation = flags.citation;
    const axes = {};
    for (const k of AXIS_KEYS) {
      if (flags[`axes-${k}`] != null)
        axes[k] = Number(flags[`axes-${k}`]);
    }
    if (Object.keys(axes).length)
      value.axes = axes;
  } else {
    value = verdictRaw;
  }
  let runId = null;
  let capturedLedger = null;
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  mutateLedgerChecked(ledgerPath(), (l) => {
    if (!l)
      throw new Error("no ledger to update");
    assertWriteToken(l, flags.token);
    capturedLedger = l;
    l.gate = l.gate ?? {};
    l.gate[which] = value;
    runId = l.session_id ?? l.run_id ?? null;
    reSeal(l, projectDir);
  });
  writeGateArtifact({ runId, which, verdictRaw, value, hasObj, flags });
  if (capturedLedger) {
    emitHookEvent({
      projectDir,
      sessionId: capturedLedger.session_id,
      type: "GATE",
      source: "hook:ledger",
      data: { which, verdict: verdictRaw, ...flags.citation ? { citation: flags.citation } : {}, ...flags.rubric ? { rubric: flags.rubric } : {} },
      ledger: capturedLedger
    });
    regenerateMotiveMap(projectDir, capturedLedger.motive);
    regenerateMotiveTraceHtml(projectDir, capturedLedger.motive);
  }
  process.stdout.write(`${which}: ${hasObj ? value.verdict : value}
`);
}
function writeGateArtifact({ runId, which, verdictRaw, value, hasObj }) {
  const base = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const gatesDir = path7.join(base, ".groundwork", "gates");
  try {
    mkdirSync5(gatesDir, { recursive: true });
  } catch {
    return;
  }
  const filename = `${runId ?? "unknown"}.md`;
  const filePath = path7.join(gatesDir, filename);
  const verdictLine = `verdict: ${verdictRaw}`;
  const lines = [verdictLine, ""];
  lines.push(`# Gate Record \u2014 ${which}`);
  lines.push(``);
  lines.push(`**Verdict:** ${verdictRaw}`);
  if (hasObj && value && typeof value === "object") {
    if (value.rubric)
      lines.push(`**Rubric:** ${value.rubric}`);
    if (value.citation)
      lines.push(`**Citation:** ${value.citation}`);
    if (value.axes && typeof value.axes === "object") {
      lines.push(``);
      lines.push("**Axes:**");
      for (const [k, v] of Object.entries(value.axes)) {
        lines.push(`- ${k}: ${v}`);
      }
    }
  }
  lines.push(``);
  lines.push(`*Recorded at ${new Date().toISOString()}*`);
  try {
    writeFileSync6(filePath, lines.join(`
`) + `
`);
  } catch {}
}
function cmdAbandon(args) {
  const { flags } = parseFlags(args ?? []);
  let capturedLedger = null;
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  mutateLedgerChecked(ledgerPath(), (l) => {
    if (!l)
      throw new Error("no ledger to abandon");
    assertWriteToken(l, flags.token);
    capturedLedger = l;
    l.active = false;
    reSeal(l, projectDir);
  });
  if (capturedLedger) {
    emitHookEvent({
      projectDir,
      sessionId: capturedLedger.session_id,
      type: "SESSION_END",
      source: "hook:ledger",
      data: { outcome: "abandoned" },
      ledger: capturedLedger
    });
    regenerateMotiveMap(projectDir, capturedLedger.motive);
    regenerateMotiveTraceHtml(projectDir, capturedLedger.motive);
  }
  process.stdout.write(`run cancelled (active:false) \u2014 gate released
`);
}
function cmdInit(args) {
  const argv = Array.isArray(args) ? args : args ? [args] : [];
  const { flags, positionals } = parseFlags(argv);
  const src = positionals[0];
  if (!src)
    die("usage: ledger init <file|-> [--motive <id>] [--token <existing-token>]", 2);
  let obj = {};
  if (src) {
    let raw;
    try {
      raw = src === "-" ? readFileSync10(0, "utf8") : readFileSync10(src, "utf8");
    } catch (e) {
      die(`cannot read initial ledger from ${src}: ${e?.message ?? e}`, 1);
    }
    try {
      obj = JSON.parse(raw);
    } catch (e) {
      die(`initial ledger is not valid JSON: ${e?.message ?? e}`, 2);
    }
  }
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  try {
    const existing = readLedger(ledgerPath());
    if (existing?.active === true && existing?.write_token) {
      if (!flags.token || flags.token !== existing.write_token) {
        die(`init would overwrite an active run \u2014 pass --token <write_token> to confirm overwrite,
` + "  or wait for the run to end (abandon/gate) before re-initializing.", 2);
      }
    }
  } catch {}
  const writeToken = randomBytes2(8).toString("hex");
  obj.write_token = writeToken;
  delete obj.token_free;
  obj.schema_version = SCHEMA_VERSION;
  try {
    const bcr = spawnSync("git", ["rev-parse", "HEAD"], { cwd: projectDir, encoding: "utf8" });
    if (bcr.status === 0)
      obj.base_commit = bcr.stdout.trim();
  } catch {}
  if (!("active" in obj))
    obj.active = true;
  const sessionId = resolveSessionId(null);
  obj.session_id = sessionId ?? randomBytes2(16).toString("hex");
  if (flags.motive != null)
    obj.motive = flags.motive;
  if (!("pacing" in obj)) {
    obj.pacing = { policy: "wave", budget: 1, exempt_kinds: ["plan", "diagnose", "design", "fog"] };
  }
  obj.pacing.offset = resolvedUnits(obj);
  checkLedgerStrict(obj);
  try {
    pruneStaleSessionLedgers(projectDir);
  } catch {}
  const key = ensureKey({ projectDir, sessionId: obj.session_id });
  obj.gate = obj.gate ?? {};
  obj.gate.seal = computeSeal(canonicalReleaseState(obj), key);
  atomicWriteJsonSync(ledgerPath(), obj);
  if (obj.motive)
    regenerateMotiveMap(projectDir, obj.motive);
  if (obj.motive)
    regenerateMotiveTraceHtml(projectDir, obj.motive);
  const n = Array.isArray(obj?.slices) ? obj.slices.length : 0;
  process.stdout.write(`ledger initialized: ${n} slices \u2192 ${ledgerPath()}
`);
  process.stdout.write(`write_token: ${writeToken}  (orchestrator: pass --token on gate/complete/abandon)
`);
}
function cmdAdd(args) {
  const { flags, positionals } = parseFlags(args);
  const id = positionals[0];
  if (!id)
    die('usage: ledger add <id> [--wave N] [--desc "\u2026"] [--kind <k>] [--blocked-by a,b] [--acceptance "a;b"] [--status pending]', 2);
  const status = flags.status ?? "pending";
  assertStatus(status);
  if (flags.kind != null)
    assertKind(flags.kind);
  const wave = flags.wave != null ? Number(flags.wave) : 0;
  const desc = flags.desc ?? "";
  const blocked_by = flags["blocked-by"] ? flags["blocked-by"].split(",").map((s) => s.trim()).filter(Boolean) : [];
  const acceptance = flags.acceptance ? flags.acceptance.split(";").map((s) => s.trim()).filter(Boolean) : [];
  const coversAcRaw = flags["covers-ac"] != null ? flags["covers-ac"].split(",").map((s) => s.trim()).filter(Boolean) : null;
  const decisionsRaw = flags["decisions"] != null ? flags["decisions"].split(",").map((s) => s.trim()).filter(Boolean) : null;
  if (coversAcRaw != null || decisionsRaw != null) {
    const addProjectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const existingLedger = readLedger(ledgerPath());
    const fold = _loadMotiveFold(addProjectDir, existingLedger?.motive);
    if (coversAcRaw != null) {
      const charterAcIds = _loadCharterAcIds(addProjectDir, existingLedger?.motive);
      const unknownAcIds = coversAcRaw.filter((id2) => !charterAcIds.has(id2));
      _assertFoldRefs(fold, unknownAcIds, "covers_ac", "ac", "ac:");
    }
    if (decisionsRaw != null)
      _assertFoldRefs(fold, decisionsRaw, "decisions", "decision", "decision:");
  }
  mutateLedgerChecked(ledgerPath(), (l) => {
    const ledger = l ?? { active: true, brief: "", slices: [], gate: {} };
    ledger.slices = Array.isArray(ledger.slices) ? ledger.slices : [];
    if (ledger.slices.some((s) => s?.id === id)) {
      const e = new Error(`slice "${id}" already exists`);
      e.exitCode = 2;
      throw e;
    }
    const item = { id, wave, status, desc, blocked_by };
    if (acceptance.length > 0)
      item.acceptance = acceptance;
    if (flags.kind != null)
      item.kind = flags.kind;
    if (flags.ticket != null) {
      assertTicket(flags.ticket);
      item.ticket = flags.ticket;
    }
    if (coversAcRaw != null && coversAcRaw.length > 0)
      item.covers_ac = coversAcRaw;
    if (decisionsRaw != null && decisionsRaw.length > 0) {
      warnDecisions(decisionsRaw);
      item.decisions = decisionsRaw;
    }
    if (flags["claimed-by"] != null) {
      item.claimed_by = flags["claimed-by"];
      item.claimed_at = new Date().toISOString();
    }
    if (flags["created-by"] != null)
      item.created_by = flags["created-by"];
    ledger.slices.push(item);
    return l === null ? ledger : undefined;
  });
  const kindNote = flags.kind != null ? `, kind=${flags.kind}` : "";
  _tryRefreshMap(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  process.stdout.write(`${id} added (wave ${wave}, ${status}${kindNote})
`);
}
function cmdRm(args) {
  const { flags, positionals: ids } = parseFlags(Array.isArray(args) ? args : []);
  if (!ids.length)
    die("usage: ledger rm <id> [<id> ...] [--token <write_token>]", 2);
  let remaining = 0;
  const missing = [];
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  mutateLedgerChecked(ledgerPath(), (l) => {
    if (!l)
      throw new Error("no ledger to update");
    assertWriteToken(l, flags.token);
    const slices = Array.isArray(l.slices) ? l.slices : [];
    const existingIds = new Set(slices.map((s) => s?.id));
    for (const id of ids) {
      if (!existingIds.has(id))
        missing.push(id);
    }
    if (missing.length) {
      const e = new Error(`unknown slice id(s): ${missing.join(", ")}`);
      e.exitCode = 2;
      throw e;
    }
    const removeSet = new Set(ids);
    l.slices = slices.filter((s) => !removeSet.has(s?.id));
    remaining = l.slices.length;
    reSeal(l, projectDir);
  });
  _tryRefreshMap(projectDir);
  process.stdout.write(`removed: ${ids.join(", ")} (${remaining} slice${remaining === 1 ? "" : "s"} remain)
`);
}
function cmdSet(args) {
  const { flags, positionals } = parseFlags(args);
  const id = positionals[0];
  if (!id)
    die('usage: ledger set <id> [--status \u2026] [--wave N] [--desc "\u2026"] [--blocked-by a,b] [--acceptance "a;b"]', 2);
  const hasFields = ["status", "wave", "desc", "blocked-by", "acceptance", "claimed-by", "ticket", "covers-ac", "decisions"].some((k) => flags[k] != null);
  if (!hasFields)
    die("ledger set: no fields provided. Specify at least one of --status --wave --desc --blocked-by --acceptance --claimed-by --ticket --covers-ac --decisions", 2);
  if (flags.status != null)
    assertStatus(flags.status);
  const updated = [];
  const TERMINAL_STATUSES = new Set(["complete", "skipped"]);
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  if (flags["covers-ac"] != null || flags["decisions"] != null) {
    const setLedger = readLedger(ledgerPath());
    const fold = _loadMotiveFold(projectDir, setLedger?.motive);
    if (flags["covers-ac"] != null) {
      const acIds = flags["covers-ac"].split(",").map((v) => v.trim()).filter(Boolean);
      const charterAcIds = _loadCharterAcIds(projectDir, setLedger?.motive);
      const unknownAcIds = acIds.filter((id2) => !charterAcIds.has(id2));
      _assertFoldRefs(fold, unknownAcIds, "covers_ac", "ac", "ac:");
    }
    if (flags["decisions"] != null) {
      const decIds = flags["decisions"].split(",").map((v) => v.trim()).filter(Boolean);
      _assertFoldRefs(fold, decIds, "decisions", "decision", "decision:");
    }
  }
  mutateLedgerChecked(ledgerPath(), (l) => {
    if (!l)
      throw new Error("no ledger to update");
    const slices = Array.isArray(l.slices) ? l.slices : [];
    const s = slices.find((s2) => s2?.id === id);
    if (!s) {
      const e = new Error(`unknown slice id "${id}"`);
      e.exitCode = 2;
      throw e;
    }
    if (flags.status != null && TERMINAL_STATUSES.has(flags.status)) {
      assertWriteToken(l, flags.token);
    }
    if (flags.status != null) {
      if (flags.status === "in_progress") {
        const pace = checkPace(l, id, flags["build-hash"] ?? null);
        if (!pace.allowed) {
          const e = new Error(`${pace.reason}
${pace.remedy}`);
          e.exitCode = 1;
          throw e;
        }
      }
      s.status = flags.status;
      if (flags.status === "complete") {
        s.completed_at = new Date().toISOString();
        s.session_id = l.session_id ?? null;
        delete s.claimed_by;
        delete s.claimed_at;
      } else if (flags.status === "skipped") {
        delete s.claimed_by;
        delete s.claimed_at;
      }
      updated.push(`status=${flags.status}`);
    }
    if (flags.wave != null) {
      s.wave = Number(flags.wave);
      updated.push(`wave=${s.wave}`);
    }
    if (flags.desc != null) {
      s.desc = flags.desc;
      updated.push(`desc="${flags.desc}"`);
    }
    if (flags["blocked-by"] != null) {
      s.blocked_by = flags["blocked-by"].split(",").map((v) => v.trim()).filter(Boolean);
      updated.push(`blocked_by=[${s.blocked_by.join(",")}]`);
    }
    if (flags.acceptance != null) {
      s.acceptance = flags.acceptance.split(";").map((v) => v.trim()).filter(Boolean);
      updated.push(`acceptance(${s.acceptance.length})`);
    }
    if (flags["claimed-by"] != null) {
      s.claimed_by = flags["claimed-by"];
      s.claimed_at = new Date().toISOString();
      updated.push(`claimed_by=${flags["claimed-by"]}`);
    }
    if (flags.ticket != null) {
      assertTicket(flags.ticket);
      s.ticket = flags.ticket;
      updated.push(`ticket=${flags.ticket}`);
    }
    if (flags["covers-ac"] != null) {
      s.covers_ac = flags["covers-ac"].split(",").map((v) => v.trim()).filter(Boolean);
      updated.push(`covers_ac=[${s.covers_ac.join(",")}]`);
    }
    if (flags["decisions"] != null) {
      s.decisions = flags["decisions"].split(",").map((v) => v.trim()).filter(Boolean);
      warnDecisions(s.decisions);
      updated.push(`decisions=[${s.decisions.join(",")}]`);
    }
    reSeal(l, projectDir);
  });
  _tryRefreshMap(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  process.stdout.write(`${id} updated: ${updated.join(" ")}
`);
}
function cmdShow(id) {
  if (!id)
    die("usage: ledger show <id>", 2);
  const l = readLedger(ledgerPath());
  if (!l)
    die("no ledger at " + ledgerPath(), 1);
  warnValidate(l);
  const slices = Array.isArray(l.slices) ? l.slices : [];
  const s = slices.find((s2) => s2?.id === id);
  if (!s)
    die(`unknown slice id "${id}"`, 2);
  const acceptance = Array.isArray(s.acceptance) && s.acceptance.length ? s.acceptance.map((a, i2) => `    [${i2 + 1}] ${a}`).join(`
`) : "    (none)";
  const blocked = Array.isArray(s.blocked_by) && s.blocked_by.length ? s.blocked_by.join(", ") : "(none)";
  const kindDisplay = s.kind != null ? s.kind : "impl (default)";
  const coversAc = Array.isArray(s.covers_ac) && s.covers_ac.length ? s.covers_ac.join(", ") : typeof s.covers_ac === "string" && s.covers_ac ? s.covers_ac : "(none)";
  const claimedBy = s.claimed_by || "(none)";
  const createdBy = s.created_by || "(none)";
  const ticket = s.ticket || "(none)";
  const decisions = Array.isArray(s.decisions) && s.decisions.length ? s.decisions.join(", ") : typeof s.decisions === "string" && s.decisions ? s.decisions : "(none)";
  process.stdout.write([
    `id:         ${s.id}`,
    `kind:       ${kindDisplay}`,
    `wave:       ${s.wave ?? 0}`,
    `status:     ${s.status ?? "pending"}`,
    `desc:       ${s.desc || "(none)"}`,
    `ticket:     ${ticket}`,
    `blocked_by: ${blocked}`,
    `covers_ac:  ${coversAc}`,
    `decisions:  ${decisions}`,
    `claimed_by: ${claimedBy}`,
    `created_by: ${createdBy}`,
    `acceptance:`,
    acceptance
  ].join(`
`) + `
`);
}
function cmdClaim(args) {
  const jsonMode = args.includes("--json");
  const strictMode = args.includes("--strict");
  const filteredArgs = args.filter((a) => a !== "--json" && a !== "--strict");
  const { flags, positionals: ids } = parseFlags(filteredArgs);
  if (!ids.length)
    die("usage: ledger claim <id> [<id> ...] [--json] [--strict]", 2);
  const currentSession = resolveSessionId(flags);
  if (!currentSession)
    die("claim requires a session id \u2014 set CLAUDE_CODE_SESSION_ID or pass --session <id>", 1);
  const refused = [];
  const claimed = [];
  mutateLedgerChecked(ledgerPath(), (l) => {
    if (!l)
      throw new Error("no ledger to update");
    const slices = Array.isArray(l.slices) ? l.slices : [];
    const byId = new Map(slices.map((s) => [s?.id, s]));
    const missing = ids.filter((id) => !byId.has(id));
    if (missing.length) {
      const e = new Error(`unknown slice id(s): ${missing.join(", ")}`);
      e.exitCode = 2;
      throw e;
    }
    const claimBuildHash = flags["build-hash"] ?? null;
    for (const id of ids) {
      const pace = checkPace(l, id, claimBuildHash);
      if (!pace.allowed) {
        const e = new Error(`${pace.reason}
${pace.remedy}`);
        e.exitCode = 1;
        throw e;
      }
    }
    const now = new Date().toISOString();
    for (const id of ids) {
      const s = byId.get(id);
      const existingOwner = s.claimed_by;
      if (!existingOwner || existingOwner === currentSession) {
        s.claimed_by = currentSession;
        s.claimed_at = now;
        claimed.push(id);
      } else {
        if (l.active === false) {
          s.claimed_by = currentSession;
          s.claimed_at = now;
          claimed.push(id);
        } else {
          refused.push({ id, claimed_by: existingOwner });
        }
      }
    }
  });
  if (claimed.length)
    _tryRefreshMap(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  if (jsonMode) {
    const ok = refused.length === 0;
    process.stdout.write(JSON.stringify({ claimed, refused, ok }) + `
`);
    if (strictMode && !ok)
      process.exit(1);
  } else {
    for (const r of refused) {
      process.stderr.write(`ledger: ${r.id} already claimed by ${r.claimed_by} \u2014 skipping
`);
    }
    if (claimed.length)
      process.stdout.write(`claimed: ${claimed.join(", ")} [session: ${currentSession}]
`);
    if (strictMode && refused.length > 0)
      process.exit(1);
  }
}
function cmdView() {
  const l = readLedger(ledgerPath());
  if (!l)
    die("no ledger at " + ledgerPath(), 1);
  warnValidate(l);
  const slices = Array.isArray(l.slices) ? l.slices : [];
  const lines = [];
  lines.push(`# Groundwork Run`);
  lines.push(``);
  lines.push(`**Brief:** ${l.brief ?? "(no brief)"}`);
  lines.push(`**Active:** ${l.active === false ? "no (abandoned)" : "yes"}`);
  lines.push(`**Session:** ${l.session_id ?? "(none)"}`);
  lines.push(``);
  const byWave = new Map;
  for (const s of slices) {
    const w = s?.wave ?? 0;
    if (!byWave.has(w))
      byWave.set(w, []);
    byWave.get(w).push(s);
  }
  const waves = [...byWave.keys()].sort((a, b) => a - b);
  for (const w of waves) {
    lines.push(`## Wave ${w}`);
    lines.push(``);
    lines.push(`| ID | Kind | Status | Blocked By | Claimed By | Decisions | Description |`);
    lines.push(`|---|---|---|---|---|---|---|`);
    for (const s of byWave.get(w)) {
      const id = s?.id ?? "?";
      const status = s?.status ?? "pending";
      const sym = SYMBOL[status] ?? status;
      const blocked = Array.isArray(s?.blocked_by) && s.blocked_by.length ? s.blocked_by.join(", ") : "\u2014";
      const desc = (s?.desc || "").replace(/\|/g, "\\|");
      const kindRaw = s?.kind ?? null;
      const kindCol = kindRaw != null ? KIND_LABEL[kindRaw] ?? kindRaw : "\u2699 impl";
      const claimedBy = s?.claimed_by ?? "\u2014";
      const decisionsArr = Array.isArray(s?.decisions) ? s.decisions : typeof s?.decisions === "string" && s.decisions ? [s.decisions] : [];
      const decisionsCol = decisionsArr.length ? decisionsArr.join(", ") : "\u2014";
      lines.push(`| \`${id}\` | ${kindCol} | ${sym} ${status} | ${blocked} | ${claimedBy} | ${decisionsCol} | ${desc} |`);
    }
    lines.push(``);
  }
  const gate = l.gate ?? {};
  lines.push(`## Gate`);
  lines.push(``);
  const advisorVal = gate.advisor;
  let advisorStr;
  if (typeof advisorVal === "string")
    advisorStr = advisorVal;
  else if (advisorVal && typeof advisorVal === "object") {
    advisorStr = advisorVal.verdict ?? "pending";
    if (advisorVal.rubric)
      advisorStr += ` \u2014 ${advisorVal.rubric}`;
  } else {
    advisorStr = "pending";
  }
  lines.push(`| Gate | Verdict |`);
  lines.push(`|---|---|`);
  lines.push(`| advisor | ${advisorStr} |`);
  if (gate.verifier != null)
    lines.push(`| verifier | ${gate.verifier} |`);
  if (gate.qa != null)
    lines.push(`| qa | ${gate.qa} |`);
  lines.push(``);
  const done = slices.filter((s) => s?.status === "complete").length;
  lines.push(`**Progress:** ${done}/${slices.length} slices complete`);
  lines.push(``);
  process.stdout.write(lines.join(`
`) + `
`);
}
function cmdFog(args) {
  const { flags, positionals } = parseFlags(args);
  const id = positionals[0];
  if (!id)
    die('usage: ledger fog <id> --desc "\u2026" --question "\u2026"', 2);
  if (!flags.desc)
    die("ledger fog: --desc is required", 2);
  if (!flags.question)
    die("ledger fog: --question is required", 2);
  mutateLedgerChecked(ledgerPath(), (l) => {
    if (!l)
      throw new Error("no ledger to update");
    const slices = Array.isArray(l.slices) ? l.slices : [];
    if (slices.some((s) => s?.id === id))
      throw Object.assign(new Error(`slice "${id}" already exists`), { exitCode: 2 });
    const item = {
      id,
      status: "pending",
      wave: flags.wave != null ? Number(flags.wave) : 0,
      kind: "fog",
      desc: flags.desc,
      question: flags.question
    };
    slices.push(item);
    l.slices = slices;
    return l;
  });
  process.stdout.write(`${id} added (fog)
`);
}
function cmdFrontier(args) {
  const { flags } = parseFlags(args);
  const currentSession = resolveSessionId(flags);
  const l = readLedger(ledgerPath());
  if (!l)
    die("no ledger at " + ledgerPath(), 1);
  warnValidate(l);
  const slices = Array.isArray(l.slices) ? l.slices : [];
  const frontier2 = frontier(slices).filter((s) => {
    return !s.claimed_by || s.claimed_by === currentSession;
  });
  if (!frontier2.length) {
    process.stdout.write(`no frontier slices \u2014 all pending slices are blocked, in progress, or claimed by another session
`);
    return;
  }
  for (const s of frontier2) {
    const wave = s.wave != null ? `w${s.wave}` : "w0";
    const desc = s.desc ? `  ${s.desc.slice(0, 60)}${s.desc.length > 60 ? "\u2026" : ""}` : "";
    const claim = s.claimed_by ? ` [claimed:${s.claimed_by}]` : "";
    process.stdout.write(`${s.id}  ${wave}${claim}${desc}
`);
  }
}
function cmdAutopilot(args) {
  const { flags } = parseFlags(args);
  if (flags.range == null)
    die('usage: ledger autopilot --range N --token <t> [--reason "..."]', 2);
  const range = Number(flags.range);
  if (!Number.isInteger(range) || range < 1)
    die("--range must be a positive integer (\u22651)", 2);
  const reason = flags.reason ?? "";
  if (!reason.trim())
    die('--reason is required and must be non-empty (e.g. --reason "operator authorized: multi-wave emergency")', 1);
  let capturedLedger = null;
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  mutateLedgerChecked(ledgerPath(), (l) => {
    if (!l)
      throw new Error("no ledger to update");
    assertWriteToken(l, flags.token);
    capturedLedger = l;
    if (!l.pacing) {
      const e = new Error("ledger has no pacing field \u2014 autopilot only applies to paced runs");
      e.exitCode = 1;
      throw e;
    }
    l.pacing.grant = {
      range: (l.pacing.grant?.range ?? 0) + range,
      granted_at: new Date().toISOString(),
      granted_by: resolveSessionId(flags) ?? process.env.CLAUDE_CODE_SESSION_ID ?? "orchestrator",
      reason
    };
    reSeal(l, projectDir);
  });
  if (capturedLedger) {
    emitHookEvent({
      projectDir,
      sessionId: capturedLedger.session_id,
      type: "MILESTONE",
      source: "hook:ledger",
      data: { event: "autopilot", range, reason },
      ledger: capturedLedger
    });
  }
  process.stdout.write(`autopilot granted: +${range} unit${range === 1 ? "" : "s"}${reason ? ` (${reason})` : ""}
`);
}
function main() {
  const argv = process.argv.slice(2);
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "-h" || cmd === "--help") {
    cmdHelp([]);
    return;
  }
  if (cmd === "help") {
    cmdHelp(rest);
    return;
  }
  const { flags } = parseFlags(rest);
  if ("help" in flags) {
    cmdHelp([cmd]);
    return;
  }
  const base = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const sessionId = resolveSessionId(flags);
  _ledgerPath = resolveLedgerPath({ projectDir: base, sessionId });
  try {
    switch (cmd) {
      case "status":
        return cmdStatus();
      case "complete":
        return cmdComplete(rest);
      case "gate":
        return cmdGate(rest);
      case "abandon":
        return cmdAbandon(rest);
      case "init":
        return cmdInit(rest);
      case "add":
        return cmdAdd(rest);
      case "rm":
        return cmdRm(rest);
      case "set":
        return cmdSet(rest);
      case "claim":
        return cmdClaim(rest);
      case "show":
        return cmdShow(rest[0]);
      case "view":
        return cmdView();
      case "fog":
        return cmdFog(rest);
      case "frontier":
        return cmdFrontier(rest);
      case "autopilot":
        return cmdAutopilot(rest);
      case "scope-token":
        return cmdScopeToken(rest);
      case "await-human":
        return cmdAwaitHuman(rest);
      case "milestone-signoff":
        return cmdMilestoneSignoff(rest);
      default:
        die(`unknown command "${cmd}". Run ledger help for a list.`, 2);
    }
  } catch (e) {
    die(e?.message ?? String(e), e?.exitCode ?? 1);
  }
}
main();
export {
  parseFlags
};
