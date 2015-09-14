var wf = require('../jsinterp');
var test = require('simple-test-framework');

test("Basics",function(t) {
    t.check(true, 'works');
    
    var env = {
	modules: {
	    'moduleid1': {
		refs: [],
		functions: {
		    'myequals': {
			numConsumed: 1,
			numProduced: 1,
			nativeCode: {'fda006f4779e4d1a87f130406418d7df':{'expr':'new Cons(s.l == s.r.l, s.r.r)'}}
		    },
		    'mypop': {
			numConsumed: 1,
			numProduced: 0,
			nativeCode: {'fda006f4779e4d1a87f130406418d7df':{'expr':'s.r'}}
		    },
		    'myswap': {
			numConsumed: 2,
			numProduced: 2,
			nativeCode: {'fda006f4779e4d1a87f130406418d7df':{'expr':'new Cons(s.r.l, new Cons(s.l, s.r.r))'}}
		    },
		    'myhead': {
			numConsumed: 1,
			numProduced: 2,
			nativeCode: {'fda006f4779e4d1a87f130406418d7df':{'expr':'new Cons(s.l.l, new Cons(s.l.r, s.r))'}}
		    },
		    'mycons': {
			numConsumed: 2,
			numProduced: 1,
			nativeCode: {'fda006f4779e4d1a87f130406418d7df':{'expr':'new Cons(new Cons(s.r.l, s.l), s.r.r)'}}
		    },
		    'myplus': {
			numConsumed: 2,
			numProduced: 1,
			nativeCode: {'fda006f4779e4d1a87f130406418d7df':{'expr':'new Cons(s.l + s.r.l, s.r.r)'}}
		    },
		    'mythreetotop': {
			numConsumed: 3,
			numProduced: 3,
			nativeCode: {'fda006f4779e4d1a87f130406418d7df':{'expr':'new Cons(s.r.l, new Cons(s.r.r.l, new Cons(s.l,s.r.r.r.r)))'}}
		    },
		    'mymap': {
			numConsumed: 2,
			numProduced: 1,
			condition: [{op:'literal', val:true}],
			code: [
			    {
				op:'cond',
				branches: [
				    {
					condition: [{op:'literal',val:null},{op:'myequals'}],
					code: [{op:'myswap'},{op:'mypop'}]
				    },
				    {
					condition: [{op:'literal', val:true}],
					code: [
					    {op:'myswap'},
					    {op:'save', name:'fn'},
					    {op:'myhead'},
					    {op:'load', name:'fn'},
					    {op:'callLambda', numConsumed:1, numProduced:1},
					    {op:'myswap'},
					    {op:'load', name:'fn'},
					    {op:'myswap'},
					    {op:'mymap'},
					    {op:'mycons'},
					]
				    }
				]
			    }
			]
		    },
		    'plusone': {
			numConsumed: 1,
			numProduced: 1,
			condition: [{op:'literal', val:true}],
			code: [
			    {op:'lambda', code: [
				{op:'literal', val:1},
				{op:'myplus'},
			    ]},
			    {op:'myswap'},
			    {op:'mymap'},
			]
		    }
		}
	    }
	}
    };

    var response = wf.execute(env.modules['moduleid1'], 'plusone', env, new wf.cons(wf.cons(42, null), null));
    t.check(response.length === 1);
    t.check(response[0].l === 43);
    t.check(response[0].r === null);

    t.finish();
});
