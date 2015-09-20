var Q = require('Q');
var axios = require('axios');
var sha256 = require('fast-sha256');
var Immutable = require('immutable');

var interpId = 'fda006f4779e4d1a87f130406418d7df';
var ERROR = undefined;
var EMPTY = Immutable.Seq();
var PLATFORM_IMPL_URL = 'http://millstonecw.com:11739/module/cc9a4b26e69e60901d521fcdc0274381';

function Cons(l, r) {
    this.l = l;
    this.r = r;
}

var emptyList = Immutable.List();
var emptyMap = Immutable.Map({});

function cons(x,y) { return new Cons(x,y); }
Cons.prototype.toArray = function() {
    var x = this;
    var ret = [];
    while (x !== null) {
	ret.push(x.l);
	x = x.r;
    }
    return ret;
};
Cons.prototype.popN = function(n) {
    var x = this;
    while (n > 0) {
	x = x.r;
	n--;
    }
    return x;
}
	
function wfTypeOf(val) {
    if (val === ERROR) {
	return 'error'; 
    } else if (typeof val === 'object') {
	if (val === null) {
	    return 'null';
	}
	if (Immutable.Map.isMap(val)) {
	    return 'map';
	}
	if (Immutable.Iterable.isIterable(val) || Immutable.List.isList(val) || Immutable.Seq.isSeq(val)) {
	    return 'list';
	}
	if (val.length && val.length == 2) {
	    return 'function';
	}
	console.log('do not know how to type this: ', val);
	throw new Error('do not know how to type this: ', val);
    } else {
	return typeof val; // boolean or number, hopefully!
    }
}

function stackToJs(stack) {
    return (stack === null) ? [] : stack.toArray();
}

function jsToWfValue(val) {
    if (typeof val === 'object') {
	return Immutable.fromJS(val);
    } else {
	return val;
    }
}

var DISPATCH = {
    'literal': function(rec, lcls, fnptr, trace, env) {
	return new Cons(jsToWfValue(rec['val']), lcls); 
    },
    'lambda': function(rec, lcls, fnptr, trace, env) {
	return new Cons([rec.code, fnptr], lcls);
    },
    'callLambda': function(rec, lcls, fnptr, trace, env) {
	var pair = lcls.l;
	return execBlock(pair[0], lcls.r, fnptr, trace, env);
    },
    'cond': function(rec, lcls, fnptr, trace, env) { 
	var branches = rec['branches'];
	var branchlen = branches.length;
	for(var i=0; i<branchlen; i++) {
	    var branch = branches[i];
	    var condition = branch.condition;
	    if (condition !== undefined) {
		var ok = execBlock(condition, lcls, fnptr, trace, env).l;
		if (!ok) { 
		    console.log('condition failed');
		    //if (ok === ERROR)  // TODO need to emulate the 'cond' inputs and outputs
		    continue;
		}
		console.log('condition passed');
	    }
	    return execBlock(branch.code, lcls, fnptr, trace, env);
	}
	throw new Error("no branch taken");
    },
    'callLambda': function(rec, lcls, fnptr, trace, env) {
	var closure = lcls.l;
	return execBlock(closure[0], lcls.r, closure[1], trace, env);
    },
    'save': function(rec, lcls, fnptr, trace, env) {
	fnptr.vars[rec.name] = lcls.l;
	return lcls.r;
    },
    'load': function(rec, lcls, fnptr, trace, env) {
	return new Cons(fnptr.vars[rec.name], lcls);
    },
}

function hashString(string) {
  var hash = 0, i, chr, len;
  if (string.length == 0) return hash;
  for (i = 0, len = string.length; i < len; i++) {
    chr   = string.charCodeAt(i);
    hash  = ((hash << 5) - hash) + chr;
    hash |= 0; // Convert to 32bit integer
  }
  return hash;
}

_BASIC_HASHES = {
    error: function(v){return 2;},
    null: function(v){return 4;},
    boolean: function(v){return v ? 8 : 16},
    number: function(v){return hashString(v.toString());},
    string: hashString,
    function: function(pair){ return hashString(pair[1].fnId) + hashString(JSON.stringify(pair[1].vars)) }, //TODO slow
    map: function(v){return v.hashCode();},
    list: function(v){return v.hashCode();},
}
function hashValue(val) {
    var typ = wfTypeOf(val);
    console.log('hashValue', val, 'withtype', typ);
    return _BASIC_HASHES[typ](val);
}

function hashInputs(lcls, fn) {
    var hash = 0;
    console.log('SAVING DJSKLD', fn);
    for(var consumed = fn.numConsumed; consumed > 0; consumed--) {
	var val = hashValue(lcls.l);
	hash  = ((hash << 5) - hash) + val;
	hash |= 0;
	lcls = lcls.r;
    }
    return hash;
}

function lookupInTrace(lcls, fnId, fn, calls) {
    var byfn = calls[fnId];
    if (byfn === undefined) return undefined;
    var hash = hashInputs(lcls, fn);
    var hits = byfn[hash];
    console.log('lookup in trace', fn, hash, 'hits:', hits, 'stack:', stackToJs(lcls));
    if (hits === undefined) return undefined;
    var numInputs = (fn._wft_numConsumed === undefined) ? fn.numConsumed : fn._wft_numConsumed;
    for(var i=hits.length-1; i>=0; i--) {
	var hit = hits[i];
	var hitItr = hit[0];
	var lclItr = lcls;
	var isSame = true;
	for(var i=0; i<numInputs; i++) {
	    console.log('lookup in trace hit check', hitItr.l, lclItr.l);
	    if (!Immutable.is(hitItr.l, lclItr.l)) {
		isSame = false;
		break;
	    }
	    lclItr = lclItr.r;
	    hitItr = hitItr.r;
	}
	if (isSame) {
	    return hit[1];
	}
    }
}

function makeSavingTracer() {
    var calls = {};
    return {
	start: function(lcls, fnId, fn) {},
	end: function(ret, lcls, fnId, fn) {
	    var byfn = calls[fnId];
	    if (byfn === undefined) {
		byfn = calls[fnId] = {};
	    }
	    var lclHash = hashInputs(lcls, fn);
	    var hits = byfn[lclHash];
	    if (hits === undefined) {
		hits = byfn[lclHash] = [];
	    }
	    console.log('SAVING hash:', lclHash, ' for ', fn.name, 'given', Immutable.List(stackToJs(lcls)).toJS()); 
	    hits.push([lcls, ret]);
	},
	forgetAboutFnId: function(fnId) {
	    delete calls[fnId];
	},
	lookupInTrace: function(lcls, fnId, fn) {
	    return lookupInTrace(lcls, fnId, fn, calls);
	},
    };
}

function makeCachedTracer(saved, optraceData) { // re-uses a cache to speed up execution if possible
    return {
        start: function(lcls, fnId, fn) {
	    var newStack = saved.lookupInTrace(lcls, fnId, fn);
	    if (newStack === undefined) {
		console.log('cache could not find ', fn.name);	
		return;
	    }
	    var consumed = (fn._wft_numConsumed === undefined) ? fn.numConsumed : fn._wft_numConsumed;
	    var produced = (fn._wft_numProduced === undefined) ? fn.numProduced : fn._wft_numProduced;
	    if (consumed > 0) {
		lcls = lcls.popN(consumed); // remove the inputs
	    }
	    for(var i=produced; i>0; i--) { // copy the outputs
		lcls = new Cons(newStack.l, lcls);
		newStack = newStack.r;
	    }
	    return lcls;
	},
        end: function(ret, lcls, fnId, fn) {},
	optrace: function(rec, lcls) {
	    if (optraceData) {
		optraceData.push([rec, lcls]);
	    }
	}
    };
}


function execFn(lcls, fnptr, trace, env) {
    var fnId = fnptr.fnId;
    var fn = fnptr.module.functions[fnId];
    var doTrace = trace !== undefined;
    if (doTrace) {
	var ret = trace.start(lcls, fnId, fn);
	if (ret !== undefined) return ret;
    }
    console.log(fn.name, 'enter');
    var ret = rawExecFn(lcls, fnptr, trace, env, fn);
    console.log(fn.name, 'exit');
    if (doTrace) {
	trace.end(ret, lcls, fnId, fn);
    }
    return ret;
}

function rawExecFn(lcls, fnptr, trace, env, fn) {
    var ret;
    if (execBlock(fn.condition, lcls, fnptr, trace, env).l) {
	console.log(fn.name, 'passed guard @ ', fnptr.module.name);
	ret = execBlock(fn.code, lcls, fnptr, trace, env);
    } else {
	var superId = fn.overrides;
	if (superId) {
	    throw new Error('does not work yet!');
	    var thisScope = {module:fnptr.module, fnId:fnptr.fnId, vars:{}};
	    var target = resolveFn(fn.overrides, fnptr.module, env.resolver);
	    ret = execFn(target, lcls, fnptr, trace, env);
	} else {
	    throw new Error('No implementation found for "' + fn.name + '"');
	}
    }
    return ret;
}

function resolveFn(op, module, resolver) {
    var resolution = op._resolved;
    var module = resolver.resolve(resolution[0]);
    var fnId = resolution[1];
    /*
    var idx = op.indexOf(':');
    if (idx == -1) {
	return {module:module, fnId:op, vars:{}};
    }
    var ref = module.refs[parseInt(op.substring(0,idx))];
    var module = resolver.resolve(ref);
    var fnId = op.substring(idx + 1);
    */
    return {module:module, fnId:fnId, vars:{}};
}

function execBlock(ops, lcls, fnptr, trace, env) {
    var doOpTrace = trace.optrace;
    ops.forEach(function(rec) {
	if (doOpTrace) {
	    doOpTrace(rec, lcls);
	}
	console.log('< ', stackToJs(lcls));
	console.log('> ', rec);
	var exec = rec._exec;
	if (! exec) {
	    var op = rec.op;
	    exec = DISPATCH[op];
	    if (! exec) {
		var newScope = resolveFn(rec, fnptr.module, env.resolver);
		var target = newScope.module.functions[newScope.fnId];
		var nativeCode = target.nativeCode;
		if (nativeCode && nativeCode[interpId]) {
		    var codeRec = nativeCode[interpId];
		    if (codeRec.expr) {
			exec = eval('false||function(rec,s,env){return '+codeRec.expr+';}');
		    } else if (codeRec.block) {
			exec = eval('false||function(rec,s,env){'+codeRec.block+'}');
		    }
		} else {
		    exec = function(c_rec, c_lcls, c_fnptr, c_trace, c_env) {
			var thisScope = {module:newScope.module, fnId:newScope.fnId, vars:{}};
			return execFn(c_lcls, thisScope, c_trace, c_env);
		    };
		}
	    }
	    rec._exec = exec;
	}
	//try {
	lcls = exec(rec, lcls, fnptr, trace, env);
	/*
	} catch(err) { // hopefully this will only happen for native code
	    console.log(err+'');
	    var fn = fnptr.module.functions[fnptr.fnId];
	    console.log('emulating fn ', fn);
	    for(var i=fn.numConsumed; i>0; i--) {
		lcls = lcls.r;
	    }
	    for(var i=fn.numProduced; i>0; i--) {
		lcls = new Cons(ERROR, lcls);
	    }
	}
	*/
    });
    return lcls;
}

function exec(ops, lcls, fnptr, trace, env) {
    if (env === undefined) env = {};
    return execBlock(ops, lcls, fnptr, trace, env);
}

function makeSha(str) {
    var hsh = sha256.sha256(str);
    return Array.prototype.map.call(hsh, function(n) {
	return n.toString(16);
    }).join('');
}

/*

function resolve(moduleUrl, modulesById, modulesByUrl) {
    return axios.get(moduleUrl).then(function(resp) {
	var moduleSrc = resp.data;
	if (typeof(moduleSrc) === 'string') {
	    try {
		module = JSON.parse(moduleSrc);
	    } catch(e) {
		e.message += ' in ' + moduleUrl;
		throw e;
	    }
	}
	var moduleId = makeSha(moduleSrc)
	modulesById[moduleId] = module;
	var promises = module['refs'].map(function(ref) {
	    var url = ref.url;
	    var alreadyLoading = modulesByUrl[url];
	    if (alreadyLoading === undefined) {
		alreadyLoading = moduleByUrl[url] = resolve(url, modulesById, modulesByUrl);
	    }
	    return alreadyLoading;
	});
	return Q.all(promises).then(function(deps) {
	    return {moduleId: moduleId, env:env}
	});
    });
}

function load(moduleUrl, env) {
    var env = {modules:{}};
    return resolve(moduleUrl, env.resolver, {})
}
*/

function wfVisitCodeEnv(moduleMap, cb) {
    Object.keys(moduleMap).forEach(function(moduleId) {
	wfVisitModule(moduleMap[moduleId], moduleId, cb, [moduleId]);
    });
}
function wfVisitModule(module, cb, path) {
    path = path || [];
    cb.module && cb.module(module, path);
    var functions = module.functions;
    Object.keys(functions).forEach(function(fnId) {
	path.push(fnId)
	var fn = functions[fnId];
	wfVisitFunction(fn, cb, path, module);
	path.pop();
    });
    cb.bottomUpModule && cb.bottomUpModule(module, path);
}
function wfVisitFunction(fn, cb, path, module) {
    path = path || [];
    cb.fn && cb.fn(fn, path, module);
    wfVisitBlock(fn, cb, path, fn, module);
    cb.bottomUpFn && cb.bottomUpFn(fn, path, module);
}
function wfVisitBlock(block, cb, path, fn, module) {
    cb.block && cb.block(block, path, fn, module);
    ['condition','code'].forEach(function(key) {
	if (block[key]) {
	    path.push('key');
	    wfVisitCodeitems(block[key], cb, path, fn, module);
	    path.pop();
	}
    });
    cb.bottomUpBlock && cb.bottomUpBlock(block, path, fn, module);
}
function wfVisitCodeitems(codeitems, cb, path, fn, module) {
    codeitems.forEach(function(codeop, idx) {
	path.push(idx);
	wfVisitCodeOp(codeop, cb, path, fn, module);
	path.pop();
    });
}
function wfVisitCodeOp(codeOp, cb, path, fn, module) {
    cb.op && cb.op(codeOp, path, fn, module);
    var op = codeOp.op;
    if (op === 'lambda') {
	wfVisitBlock(codeOp, cb, path, fn, module);
    } else if (op === 'cond') {
	path.push('branches');
	codeOp.branches.forEach(function(block, idx) { 
	    path.push(idx);
	    wfVisitBlock(block, cb, path, fn, module);
	    path.pop();
	});
	path.pop();
    }
    cb.bottomUpOp && cb.bottomUpOp(codeOp, path, fn, module);
}


function orderModuleDeps(moduleId, resolver, seen) {
    if (seen[moduleId]) return [];
    seen[moduleId] = true;
    var result = [];
    var module = resolver.resolve(moduleId);
    if (! module) {
	console.log('Module not found: ', moduleId);
    }
    module.refs.forEach(function(ref) {
	var refModuleId = resolver.moduleId(ref);
	result = result.concat(orderModuleDeps(refModuleId, resolver, seen));
    });
    result.push(moduleId);
    return result;
}

function rewireBlock(block, fnRemap, moduleId, resolver) {
    if (block.condition) {
	rewireCode(block.condition, fnRemap, moduleId, resolver);
    }
    rewireCode(block.code, fnRemap, moduleId, resolver);
}

function noop(){}

_REWIRE_MAP = {
    lambda: function(op, fnRemap, moduleId, resolver) { return rewireBlock(op, fnRemap, moduleId, resolver); },
    cond: function(op, fnRemap, moduleId, resolver) {
	op.branches.forEach(function(block) { return rewireBlock(block, fnRemap, moduleId, resolver); });
    },
    literal: noop,
    callLambda: noop,
    save: noop,
    load: noop,
    dynamicScope: noop,
};

function rewireCode(code, fnRemap, moduleId, resolver) {
    code.forEach(function(op) {
	var opcode = op.op;
	var action = _REWIRE_MAP[opcode];
	if (action !== undefined) {
	    return action(op, fnRemap, moduleId, resolver);
	} else {
	    var absId = absFnId(opcode, moduleId, resolver);
	    var target = fnRemap[absId];
	    if (target.join(':') !== absId) {
		console.log('rewire from ', absId, ' to ', target);
	    }
	    op._resolved = target;
	}
    });
}

function orderModules(moduleIds, resolver) {
    var seen = {};
    var results = [];
    moduleIds.forEach(function(moduleId) {
	results = results.concat(orderModuleDeps(moduleId, resolver, seen));
    });
    return results;
}

function absFnId(relativeId, moduleId, resolver) {
    var idx = relativeId.indexOf(':');
    if (idx == -1) return moduleId + ':' + relativeId;
    var module = resolver.resolve(moduleId);
    var ref = module.refs[parseInt(relativeId.substring(0, idx))];
    return resolver.moduleId(ref) + ':' + relativeId.substring(idx+1);
}

function resolveOverrides(moduleId, resolver, pluginModuleIds) {
    var moduleIds = pluginModuleIds.concat([moduleId]);
    console.log('Begin resolving overrides.  Modules given: ', moduleIds);
    moduleIds = orderModules(moduleIds, resolver);
    console.log('Resolving overrides.  Module order: ', moduleIds);
    // pass one : populate fnRemap
    var fnRemap = {};
    moduleIds.forEach(function(moduleId) {
	var module = resolver.resolve(moduleId);
	console.log('scanning module ', moduleId, module.name);
	Object.keys(module.functions).forEach(function(fnId) {
	    var fn = module.functions[fnId];
	    if (fn.nativeCode && ! fn.code) return;
	    console.log('scanning fn ', fn.name);
	    var myAbsId = moduleId + ':' + fnId;
	    if (fn.overrides) {
		var overridden = absFnId(fn.overrides, moduleId, resolver);
		fnRemap[overridden] = [moduleId, fnId];
		console.log('override', overridden, ' to ', moduleId+':'+fnId);
	    }
	    fnRemap[myAbsId] = [moduleId, fnId];
	});
    });
    // pass two : rewire all the function pointers
    moduleIds.forEach(function(moduleId) {
	var module = resolver.resolve(moduleId);
	Object.keys(module.functions).forEach(function(fnId) {
	    var fn = module.functions[fnId];
	    rewireBlock(fn, fnRemap, moduleId, resolver);
	});
    });
}

_FINDERS = {
    'map': function(value, container, path) {
	throw new Error();
    },
    'list': function(value, container, path) {
	var hit = undefined;
	container.forEach(function(item, idx) {
	    path.push(idx);
	    hit = findValueIn(value, item, path);
	    if (hit) return false;
	    path.pop();
	    return true;
	});
	return hit;
    }
}

function findValueIn(value, container, path) {
    path = path || [];
    if (value === container) return path;
    var finder = _FINDERS[wfTypeOf(container)];
    if (finder === undefined) return undefined;
    return finder(value, container, path);
}

module.exports = {
    emptyStack: function() { return null; },
    cons: function(x,y){ return new Cons(x,y); },
    stackToWfList: function(stack){ return Immutable.List(stackToJs(stack));},
//    load: load,
    interpreterId: interpId,
    platformImplUrl: PLATFORM_IMPL_URL,
    makeSavingTracer: makeSavingTracer,
    makeCachedTracer: makeCachedTracer,
    typeOf: wfTypeOf,
    visitModule: wfVisitModule,
    visitFunction: wfVisitFunction,
    visitBlock: wfVisitBlock,
    visitCodeOp: wfVisitCodeOp,
    findValueIn: findValueIn,

    isFunctionCall: function(op){ return DISPATCH[op.op] === undefined; },
    prepare: function(rootModuleId, resolver, plugins) {
	resolveOverrides(rootModuleId, resolver, plugins);
	return function executor(moduleId, fnId, lcls, tracer) {
	    var env = {resolver:resolver};
	    var module = resolver.resolve(moduleId);
	    var ret = stackToJs(rawExecFn(lcls, {module:module, fnId:fnId, vars:{}}, tracer, env, module.functions[fnId]));
	    console.log('execute result: ', ret);
	    return ret;
	};
    }
};
