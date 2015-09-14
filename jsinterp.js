var Q = require('Q');
var axios = require('axios');
var sha256 = require('fast-sha256');
var Immutable = require('immutable');

var interpId = 'fda006f4779e4d1a87f130406418d7df';
var ERROR = new Error();
var EMPTY = Immutable.Seq();
var PLATFORM_IMPL_URL = 'http://millstonecw.com:11739/module/0c983a57ded9274a5b1b9269b82ee00b';

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
	    if (condition === undefined || execBlock(condition, lcls, fnptr, trace, env).l) {
		return execBlock(branch.code, lcls, fnptr, trace, env);
	    }
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
    undefined: function(v){return 2;},
    null: function(v){return 4;},
    boolean: function(v){return v ? 8 : 16},
    number: function(v){return hashString(v.toString());},
    string: hashString,
    object: function(v){return v.hashCode();} // immutable.js provides this
}
function hashValue(val) {
    return _BASIC_HASHES[typeof val](val);
}

function hashInputs(lcls, fn) {
    var hash = 0;
    for(var consumed = fn.numConsumed; consumed > 0; consumed--) {
	hash  = ((hash << 5) - hash) + hashVal(lcls.l);
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
    if (hits === undefined) return undefined;
    var numInputs = fn.numConsumed;
    for(var i=hits.length-1; i>=0; i--) {
	var hit = hits[i];
	var isSame = true;
	var hitItr = hit[0];
	var lclItr = lcls;
	for(var i=0; i<numInputs; i++) {
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
	start: function(lcls, fnId, fn) {
	},
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
	    hits.push([lcls, ret]);
	},
	lookupInTrace: function(lcls, fnId, fn) {
	    return lookupInTrace(lcls, fnId, fn, calls);
	}
    };
}

function execFn(lcls, fnptr, trace, env) {
    var fnId = fnptr.fnId;
    var doTrace = trace !== undefined;
    if (doTrace) {
	var ret = trace.start(lcls, fnId, env);
	if (ret) return ret;
    }
    var fn = fnptr.module.functions[fnId];
    var ret;
    if (execBlock(fn.condition, lcls, fnptr, trace, env).l) {
	ret = execBlock(fn.code, lcls, fnptr, trace, env);
    } else {
	var superId = fn.overrides;
	if (superId) {
	    throw Error('does not work yet!');
	    var thisScope = {module:fnptr.module, fnId:fnptr.fnId, vars:{}};
	    var target = resolveFn(fn.overrides, fnptr.module, env.resolver);
	    ret = execFn(target, lcls, fnptr, trace, env);
	} else {
	    throw new Error('No implementation found for "' + fn.name + '"');
	}
    }
    if (doTrace) {
	trace.end(lcls, fnId, ret, env);
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
    ops.forEach(function(rec) {
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
	try { 
	    lcls = exec(rec, lcls, fnptr, trace, env);
	} catch(err) { // hopefully this will only happen for native code
	    console.log(err+'');
	    var fn = fnptr.module.functions[fnptr.fnId];
	    for(var i=fn.numConsumed; i>0; i--) {
		lcls = lcls.r;
	    }
	    for(var i=fn.numProduced; i>0; i--) {
		lcls = new Cons(ERROR, lcls);
	    }
	}
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

function orderModuleDeps(moduleId, resolver, seen) {
    var result = [];
    var module = resolver.resolve(moduleId);
    console.log('m', moduleId, module);
    module.refs.forEach(function(ref) {
	var moduleId = resolver.moduleId(ref);
	if (seen[moduleId]) return;
	seen[moduleId] = true;
	result = result.concat(orderModuleDeps(resolver.moduleId(ref), resolver, seen));
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
	    console.log('remap', absId);
	    var target = fnRemap[absId];
	    if (target.join(':') !== absId) {
		console.log('rewired ', absId, target);
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
    moduleIds = orderModules(moduleIds, resolver, {});
    console.log('order: ', moduleIds);
    var fnRemap = {};
    moduleIds.forEach(function(moduleId) {
	var module = resolver.resolve(moduleId);
	console.log('consider module', moduleId, module.name);
	Object.keys(module.functions).forEach(function(fnId) {
	    var fn = module.functions[fnId];
	    console.log('consider fn', fn.name);
	    if (fn.nativeCode && ! fn.code) return;
	    var myAbsId = moduleId + ':' + fnId;
	    if (fn.overrides) {
		var overridden = absFnId(fn.overrides, moduleId, resolver);
		fnRemap[overridden] = [moduleId, fnId];
	    }
	    fnRemap[myAbsId] = [moduleId, fnId];
	    rewireBlock(fn, fnRemap, moduleId, resolver);
	    console.log('assign', myAbsId, fnRemap[myAbsId].join(':'));
	});
    });
}

module.exports = {
    cons: function(x,y){ return new Cons(x,y); },
//    load: load,
    platformImplUrl: PLATFORM_IMPL_URL,
    makeSavingTracer: makeSavingTracer,
    execute: function(moduleId, fnId, resolver, lcls, tracer, plugins) {
	resolveOverrides(moduleId, resolver, plugins);
	var env = {resolver:resolver};
	var module = resolver.resolve(moduleId);
	var ret = stackToJs(execFn(lcls, {module:module, fnId:fnId, vars:{}}, tracer, env));
	console.log('execute result: ', ret[1].toJS());
	return ret;
    }
};
