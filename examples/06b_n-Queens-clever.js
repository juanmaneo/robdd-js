"use strict";

let fileStream = (() => {
    const start        = process.hrtime(),
          outName      = module.filename + ".out",
          util         = require('util'),
          fs           = require('fs'),
          stdout_write = process.stdout.write,
          process_exit = process.exit;
    let fileStream = fs.createWriteStream(outName, { flags: "w" }); // at start, open for writing

    fileStream.cork();

    function stdout_write_wrapper() {
        stdout_write.call(process.stdout, ...arguments);
        fileStream.write(...arguments);
        let ws = fileStream._writableState;
        if (ws.needDrain) {
            fs.appendFileSync(outName, Buffer.concat(ws.getBuffer().map(writeReq => writeReq.chunk), ws.length));
            //fileStream.end();
            fileStream = fs.createWriteStream(outName, { flags: "a" }); // from now on append
            fileStream.cork();
        }
    };

    process.on("exit", code => {
        let now    = process.hrtime(),
            prec   = 100, // 10**2
            time   = Math.round((now[0] - start[0])*prec + (now[1] - start[1]) / (1e9/prec)) / prec,
            endMsg = "\n" + "-".repeat(20) + "\nexit code: " + code + ", time: " + time + " sec";
        console.log(endMsg);
        process.stdout.write = stdout_write;
        let ws = fileStream._writableState;
        fs.appendFileSync(outName, Buffer.concat(ws.getBuffer().map(writeReq => writeReq.chunk), ws.length));
    });

    process.stdout.write = stdout_write_wrapper;
}());



const util   = require('util'),
      assert = require('pimped-assert').assert;

const BDD    = require('../lib/BDD'),
      T      = BDD.True,
      F      = BDD.False,
      ite    = BDD.ite,
      and    = BDD.and,
      or     = BDD.or,
      xor    = BDD.xor,
      eqv    = BDD.eqv,
      imp    = (p, q) => or(p.not, q),
      gv     = require('../lib/BDD-gv'),
      bitstr = require('../lib/BDD-bitstr').bitstr,
      common = require('./06_n-Queens-common'),
      exactly1          = common.exactly1,
      exactly1_withAND  = common.exactly1_withAND,
      atmost1           = common.atmost1,
      pairwise_neq      = common.pairwise_neq
      ;
const BDDser = require('../lib/BDD-serialization'),
      serialize   = BDDser.serialize,
      deserialize = BDDser.deserialize
;


let n = 10,
    rank = common.makeRanks(n, { interleaved: false, MSBfirst: false }),
    bitLen = rank[0].length,
    p, q, r,
    stats1, stats2
;

q = T;
//q = rank[0].lt(rank[1])  // remove a tiny bit of symmetry

let constraints = [
    ...rank.map(r => r.lte(n - 1)),  // ATTENTION: r.lt(n) yields F if n > (1 << (r.length-1))
    ...pairwise_neq(rank),
    q
];

function diagonalMoves(ranks, distance) {
    let n  = ranks.length,
        k  = n - distance,
        cs = [];
    for (let a = 0, b = a + distance; a < k; a++, b++) {
        let tlbr = imp( ranks[a].lt(k),  ranks[b].neq(ranks[a].plus(distance)) ),
            trbl = imp( ranks[b].lt(k),  ranks[a].neq(ranks[b].plus(distance)) );
        cs.push(tlbr);
        cs.push(trbl);
    }
    return cs;  //  [and.apply(null, cs)];  //
}



for (let d = n - 1; d > 0; d--) {
    let moves = diagonalMoves(rank, d),
        sizes = moves.map(m => m.size),
        ttlSize = sizes.reduce((acc, s) => acc + s);
    console.log(n + "x" + n + "/d" + d + ": " + moves.length + " moves, size(s): " + ttlSize + " = " + sizes.join(" + "));
    moves.forEach(move => constraints.push(move));
    console.log("  constraints: " + constraints.length + " formulas");
    console.log("  ~> " + q.size + " nodes, " + q.satPathCount + " satPaths, " + (Math.round(BDD.stats().calls.ttl/100000)/10) + "M calls");
}
q = and.apply(null, constraints);
console.log("  ~> " + q.size + " nodes, " + q.satPathCount + " satPaths, " + (Math.round(BDD.stats().calls.ttl/100000)/10) + "M calls");


try {
    common.checkSolution(n, q);
} catch (e) {
    let s = q.size;
    if (s > 1000) {
        console.log("size = " + s + " too large to render as graph");
    } else {
        gv.render(q, { satPathCount: true });
    }
    console.log("n: " + n + "\n" + e);
}

console.log(BDD.stats());
//gv.render(q);
console.log("-----------------");
let s = serialize(q, { useSwap: true, useFlip: true, useFlop: true });
console.log("serialize(q):\n" + s.stats());
console.log("pass 2...");
s = s.optimize();
console.log("serialize(q).optimize():\n" + s.stats());


//process.exit();


// make (smaller) solution BDD with different variable ordering
let map = {},
    rankI = common.makeRanks(n, { interleaved: true, MSBfirst: true });
for (let r = 0; r < n; r++) {
    for (let b = 0; b < bitLen; b++) {
        let key = rank[r][b].toString(),
            val = rankI[r][b];
        map[key] = val;
        map["!" + key] = val.not;
    }
}


function byLabelReverse(p, q) {
    let r = BDD.byLabel(q, p);
    if (r === 0) {
        if (p !== q) {
            if (p.onTrue === T) {
                r = -1;
            } else if (q.onTrue === T) {
                r = +1;
            }
        }
    }
    return r;
}

function csCmp(a, b) {
    let n = a.length,
        m = b.length,
        i = 0,
        r = byLabelReverse(a[i], b[i]);
    i++;
    while ((r === 0) && (i < n) && (i < m)) {
        r = byLabelReverse(a[i], b[i]);
        i++;
    }
    if (r === 0) {
        r = (n < m) ? -1 : (n > m ? +1 : 0);
    }
    return r;
}

function rename_sat(q) {
    let ds = new Array(q.satPathCount),
        j  = 0;
    for (let p of q.satPaths()) {
        ds[j++] = and.apply(null, [...p()].map(v => map[v.toString()]));
    }
    return or.apply(null, ds);
}

function rename_ser() {
    let k = 1000,
        i = 0,
        j = k,
        start = process.hrtime(),
        tm = 0,
        result = s.run((label, thenChild, elseChild, t) => {
            if (--j === 0) {
                let now  = process.hrtime(),
                    prec = 100, // 10**2
                    time = Math.round((now[0] - start[0])*prec + (now[1] - start[1]) / (1e9/prec)) / prec;
                i += k;
                j = k;
                console.log(i + " after " + time + " sec (" + (Math.round(t*prec) / prec) + " sec for src-ops)");
            }
            tm = t;
            return ite(map[label], thenChild, elseChild);
        });
    let now  = process.hrtime(),
        prec = 100, // 10**2
        time = Math.round((now[0] - start[0])*prec + (now[1] - start[1]) / (1e9/prec)) / prec;
    i += k - j;
    console.log(i + " after " + time + " sec (" + (Math.round(tm*prec) / prec) + " sec for src-ops)");
    return result;
}

console.log("----------------");
p = rename_sat(q);    //rename_ser();   //
console.log("  ~> " + p.size + " nodes, " + p.satPathCount + " satPaths, " + (Math.round(BDD.stats().calls.ttl/100000)/10) + "M calls");
console.log(BDD.stats());
common.checkSolution(n, p);


//gv.render(q);
console.log("-----------------");
let t = serialize(p, { useSwap: true, useFlip: true, useFlop: true }).optimize();
console.log("serialize(p).optimize():\n" + t.stats());
console.log(JSON.stringify(t));
//console.log(t.toString());


/*
{"maxLen":281,"BDDsize":8865,"BDDheight":40,"resultSlot":220,
"labels":["3J","3I","3H","3G","3F","3E","3D","3C","3B","3A","2J","2I","2H","2G","2F","2E","2D","2C","2B","2A","1J","1I","1H","1G","1F","1E","1D","1C","1B","1A","0J","0I","0H","0G","0F","0E","0D","0C","0B","0A"],
"labelDeltas":[-7445,1],
"thenOps+elseOps":2617,
"srcOps":2530,
"thenSwaps+thenFlips+elseSwaps+elseFlips":3920,
"swapsFlips":2613,
"swapsFlips2":"1309/[106,1,73,2,83,3,126,2,80,2,42,1,51,2,70,2,66,2,28,2,88,1,47,1,61,1,37,1,5,1,35,2,116,1,43,2,116,2,34,1,71,2,68,2,60,1,41,1,87,2,62,2,18,1,73,1,81,2,62,2,66,1,27,1,5,1,101,1,77,2,74,1,73,1,53,1,59,1,53,1,47,2,56,1,51,2,68,1,51,2,136,2,60,2,65,1,68,2,54,2,58,2,92,1,79,1,63,2,4,1,41,1,75,2,20,2,64,1,15,1,67,2,36,2,28,2,64,2,46,2,34,2,44,1,103,1,53,2,28,1,13,2,58,2,50,1,55,2,76,1,51,2,18,2,44,1,15,2,22,2,32,1,53,1,51,2,54,1,29,2,22,1,81,1,73,2,38,1,37,2,88,1,39,1,75,1,71,1,23,1,25,2,48,1,63,1,77,2,72,2,72,1,59,1,77,2,56,2,106,2,64,2,60,2,60,2,64,1,31,1,67,2,54,1,41,2,20,2,48,2,50,1,61,1,47,2,20,1,45,1,1,1,88,1,70,1,57,2,34,2,60,2,40,1,69,1,29,2,58,1,11,2,48,2,16,2,18,2,22,1,41,1,59,1,61,2,50,2,20,2,26,1,27,1,45,2,94,2,40,2,60,2,40,2,66,2,54,1,42,2,67,1,25,1,15,2,40,2,48,1,37,2,14,2,48,2,48,1,91,2,16,1,129,2,14,1,51,2,46,1,53,1,24,1,10,1,73,1,59,1,43,1,59,2,62,1,79,1,69,2,30,2,72,1,45,2,70,2,68,2,14,1,51,2,70,1,51,1,41,1,43,1,43,1,59,2,40,1,3,1,47,1,67,2,34,1,51,2,74,1,51,1,37,1,71,2,58,2,72,2,52,2,52,1,73,2,86,2,16,1,59,1,57,2,102,2,68,1,19,1,33,2,38,1,41,2,40,2,42,1,43,2,52,1,33,2,40,2,8,1,97,2,12,2,11,1,11,1,40,2,8,1,29,1,45,1,37,1,33,1,31,1,59,2,2,2,34,1,19,2,50,3,45,1,97,2,28,2,52,2,54,1,15,2,14,1,13,2,29,1,30,1,33,1,45,1,35,1,35,1,33,1,2,1,34,2,40,1,57,2,42,1,71,2,40,1,23,2,40,2,44,1,33,1,8,1,12,2,22,1,5,2,54,1,83,1,33,2,48,1,45,2,84,1,71,2,40,2,6,1,55,2,62,3,43,2,62,1,47,2,34,2,20,2,50,2,45,1,6,2,34,2,20,1,69,2,46,2,44,2,27,3,50,2,38,1,17,1,77,1,31,2,38,1,45,2,22,2,66,2,52,1,33,1,19,1,33,2,46,2,48,1,17,1,55,1,25,1,19,2,54,1,73,1,91,1,67,1,5,2,54,1,49,1,43,2,38,2,54,1,70,1,56,1,43,1,87,2,14,1,43,1,37,1,61,2,12,1,67,2,28,1,27,2,38,1,37,4,46,2,12,2,18,2,54,2,40,1,3,2,19,1,42,1,21,2,92,2,46,1,55,2,16,1,36,1,30,1,41,1,31,2,40,2,34,2,24,2,18,2,44,1,37,2,4,2,56,1,21,1,37,1,37,2,12,1,33,2,64,2,30,1,23,1,17,2,40,2,70,2,18,1,35,2,24,4,54,1,29,2,22,2,40,2,78,2,46,2,30,2,26,1,9,2,74,1,1,2,64,2,36,1,57,2,48,1,7,1,13,1,39,1,41,1,29,2,20,2,16,1,59,2,32,2,38,1,11,1,27,1,23,2,38,1,19,2,52,1,67,2,116,1,21,2,46,2,50,1,69,2,42,2,38,1,23,2,2,1,43,2,58,1,8,1,42,1,51,1,55,2,26,2,40,2,46,2,60,1,39,2,22,1,41,1,45,1,35,2,72,2,60,2,30,1,45,1,39,1,47,2,42,2,38,1,41,1,43,1,67,2,46,2,54,2,54,2,64,1,69,1,35,1,21,2,54,4,30,1,35,1,19,2,40,1,69,1,35,1,15,2,50,2,62,1,37,1,21,1,59,2,98,1,53,2,10,2,58,2,20,2,34,2,2,1,27,2,62,1,39,2,22,1,51,1,27,1,13,1,53,2,34,2,12,1,25,1,31,1,5,2,8,1,45,1,11,1,49,2,50,2,42,1,17,2,26,2,52,1,27,2,22,1,9,2,56,1,41,1,29,1,69,2,48,2,54,2,38,2,50,2,38,1,47,1,31,1,43,1,47,2,56,1,37,1,19,1,33,1,43,1,51,1,13,2,54,1,35,2,26,2,2,1,35,1,9,2,48,1,38,3,58,1,35,2,22,1,5,2,66,2,40,1,11,1,55,2,82,2,54,2,18,1,19,2,32,2,57,1,28,1,9,1,43,1,31,2,34,2,50,1,21,2,44,1,49,2,76,2,44,1,61,1,29,1,43,2,32,2,52,2,46,1,57,1,53,1,57,2,54,2,24,2,58,1,49,2,50,1,41,2,50,1,37,2,54,2,76,2,62,2,22,1,33,1,31,1,47,1,11,2,40,2,24,1,27,2,42,1,53,2,36,2,14,2,70,2,16,2,48,1,31,1,55,2,26,1,49,1,57,1,49,1,49,1,55,1,37,2,32,2,56,2,1,1,42,1,43,2,22,2,26,2,32,2,60,1,47,1,55,1,27,1,31,2,34,2,38,2,60,2,40,2,54,2,46,1,73,1,51,2,46,2,36,1,7,1,45,2,42,1,42,1,58,1,31,1,27,1,31,1,59,1,47,2,20,2,50,2,10,2,38,1,41,1,11,1,43,2,62,1,45,1,41,1,23,2,46,1,47,1,39,1,47,1,55,2,68,1,53,1,37,2,32,2,30,3,43,2,72,2,50,1,15,1,47,2,52,1,31,2,66,2,56,2,52,2,60,2,100]",
"swapsFlips2_0":"655/[106,73,83,126,80,42,51,70,66,28,88,47,61,37,5,35,116,43,116,34,71,68,60,41,87,62,18,73,81,62,66,27,5,101,77,74,73,53,59,53,47,56,51,68,51,136,60,65,68,54,58,92,79,63,4,41,75,20,64,15,67,36,28,64,46,34,44,103,53,28,13,58,50,55,76,51,18,44,15,22,32,53,51,54,29,22,81,73,38,37,88,39,75,71,23,25,48,63,77,72,72,59,77,56,106,64,60,60,64,31,67,54,41,20,48,50,61,47,20,45,1,88,70,57,34,60,40,69,29,58,11,48,16,18,22,41,59,61,50,20,26,27,45,94,40,60,40,66,54,42,67,25,15,40,48,37,14,48,48,91,16,129,14,51,46,53,24,10,73,59,43,59,62,79,69,30,72,45,70,68,14,51,70,51,41,43,43,59,40,3,47,67,34,51,74,51,37,71,58,72,52,52,73,86,16,59,57,102,68,19,33,38,41,40,42,43,52,33,40,8,97,12,11,11,40,8,29,45,37,33,31,59,2,34,19,50,45,97,28,52,54,15,14,13,29,30,33,45,35,35,33,2,34,40,57,42,71,40,23,40,44,33,8,12,22,5,54,83,33,48,45,84,71,40,6,55,62,43,62,47,34,20,50,45,6,34,20,69,46,44,27,50,38,17,77,31,38,45,22,66,52,33,19,33,46,48,17,55,25,19,54,73,91,67,5,54,49,43,38,54,70,56,43,87,14,43,37,61,12,67,28,27,38,37,46,12,18,54,40,3,19,42,21,92,46,55,16,36,30,41,31,40,34,24,18,44,37,4,56,21,37,37,12,33,64,30,23,17,40,70,18,35,24,54,29,22,40,78,46,30,26,9,74,1,64,36,57,48,7,13,39,41,29,20,16,59,32,38,11,27,23,38,19,52,67,116,21,46,50,69,42,38,23,2,43,58,8,42,51,55,26,40,46,60,39,22,41,45,35,72,60,30,45,39,47,42,38,41,43,67,46,54,54,64,69,35,21,54,30,35,19,40,69,35,15,50,62,37,21,59,98,53,10,58,20,34,2,27,62,39,22,51,27,13,53,34,12,25,31,5,8,45,11,49,50,42,17,26,52,27,22,9,56,41,29,69,48,54,38,50,38,47,31,43,47,56,37,19,33,43,51,13,54,35,26,2,35,9,48,38,58,35,22,5,66,40,11,55,82,54,18,19,32,57,28,9,43,31,34,50,21,44,49,76,44,61,29,43,32,52,46,57,53,57,54,24,58,49,50,41,50,37,54,76,62,22,33,31,47,11,40,24,27,42,53,36,14,70,16,48,31,55,26,49,57,49,49,55,37,32,56,1,42,43,22,26,32,60,47,55,27,31,34,38,60,40,54,46,73,51,46,36,7,45,42,42,58,31,27,31,59,47,20,50,10,38,41,11,43,62,45,41,23,46,47,39,47,55,68,53,37,32,30,43,72,50,15,47,52,31,66,56,52,60,100]",
"swapsFlips2_1":"654/[1,2,3,2,2,1,2,2,2,2,1,1,1,1,1,2,1,2,2,1,2,2,1,1,2,2,1,1,2,2,1,1,1,1,2,1,1,1,1,1,2,1,2,1,2,2,2,1,2,2,2,1,1,2,1,1,2,2,1,1,2,2,2,2,2,2,1,1,2,1,2,2,1,2,1,2,2,1,2,2,1,1,2,1,2,1,1,2,1,2,1,1,1,1,1,2,1,1,2,2,1,1,2,2,2,2,2,2,1,1,2,1,2,2,2,1,1,2,1,1,1,1,1,2,2,2,1,1,2,1,2,2,2,2,1,1,1,2,2,2,1,1,2,2,2,2,2,2,1,2,1,1,2,2,1,2,2,2,1,2,1,2,1,2,1,1,1,1,1,1,1,2,1,1,2,2,1,2,2,2,1,2,1,1,1,1,1,2,1,1,1,2,1,2,1,1,1,2,2,2,2,1,2,2,1,1,2,2,1,1,2,1,2,2,1,2,1,2,2,1,2,2,1,1,2,1,1,1,1,1,1,2,2,1,2,3,1,2,2,2,1,2,1,2,1,1,1,1,1,1,1,1,2,1,2,1,2,1,2,2,1,1,1,2,1,2,1,1,2,1,2,1,2,2,1,2,3,2,1,2,2,2,2,1,2,2,1,2,2,2,3,2,1,1,1,2,1,2,2,2,1,1,1,2,2,1,1,1,1,2,1,1,1,1,2,1,1,2,2,1,1,1,1,2,1,1,1,2,1,2,1,2,1,4,2,2,2,2,1,2,1,1,2,2,1,2,1,1,1,1,2,2,2,2,2,1,2,2,1,1,1,2,1,2,2,1,1,2,2,2,1,2,4,1,2,2,2,2,2,2,1,2,1,2,2,1,2,1,1,1,1,1,2,2,1,2,2,1,1,1,2,1,2,1,2,1,2,2,1,2,2,1,2,1,2,1,1,1,1,2,2,2,2,1,2,1,1,1,2,2,2,1,1,1,2,2,1,1,1,2,2,2,2,1,1,1,2,4,1,1,2,1,1,1,2,2,1,1,1,2,1,2,2,2,2,2,1,2,1,2,1,1,1,1,2,2,1,1,1,2,1,1,1,2,2,1,2,2,1,2,1,2,1,1,1,2,2,2,2,2,1,1,1,1,2,1,1,1,1,1,1,2,1,2,2,1,1,2,1,3,1,2,1,2,2,1,1,2,2,2,1,2,2,1,1,1,1,2,2,1,2,1,2,2,1,1,1,2,2,2,1,1,1,2,2,2,1,2,1,2,1,2,2,2,2,1,1,1,1,2,2,1,2,1,2,2,2,2,2,1,1,2,1,1,1,1,1,1,2,2,2,1,1,2,2,2,2,1,1,1,1,2,2,2,2,2,2,1,1,2,2,1,1,2,1,1,1,1,1,1,1,2,2,2,2,1,1,1,2,1,1,1,2,1,1,1,1,2,1,1,2,2,3,2,2,1,1,2,1,2,2,2,2,2]",
"code":[]
}
*/

/*
{"maxLen":281,"BDDsize":8865,"BDDheight":40,"resultSlot":220,
"labels":["3J","3I","3H","3G","3F","3E","3D","3C","3B","3A","2J","2I","2H","2G","2F","2E","2D","2C","2B","2A","1J","1I","1H","1G","1F","1E","1D","1C","1B","1A","0J","0I","0H","0G","0F","0E","0D","0C","0B","0A"],
"labelDeltas":[-7445,1],
"thenOps+elseOps":2617,
"srcOps":2530,
"thenSwaps+thenFlips+elseSwaps+elseFlips":3920,
"swapsFlips":2613,
"swapsFlips2":"1309/[106,1,73,2,83,3,126,2,80,2,42,1,51,2,70,2,66,2,28,2,88,1,47,1,61,1,37,1,5,1,35,2,116,1,43,2,116,2,34,1,71,2,68,2,60,1,41,1,87,2,62,2,18,1,73,1,81,2,62,2,66,1,27,1,5,1,101,1,77,2,74,1,73,1,53,1,59,1,53,1,47,2,56,1,51,2,68,1,51,2,136,2,60,2,65,1,68,2,54,2,58,2,92,1,79,1,63,2,4,1,41,1,75,2,20,2,64,1,15,1,67,2,36,2,28,2,64,2,46,2,34,2,44,1,103,1,53,2,28,1,13,2,58,2,50,1,55,2,76,1,51,2,18,2,44,1,15,2,22,2,32,1,53,1,51,2,54,1,29,2,22,1,81,1,73,2,38,1,37,2,88,1,39,1,75,1,71,1,23,1,25,2,48,1,63,1,77,2,72,2,72,1,59,1,77,2,56,2,106,2,64,2,60,2,60,2,64,1,31,1,67,2,54,1,41,2,20,2,48,2,50,1,61,1,47,2,20,1,45,1,1,1,88,1,70,1,57,2,34,2,60,2,40,1,69,1,29,2,58,1,11,2,48,2,16,2,18,2,22,1,41,1,59,1,61,2,50,2,20,2,26,1,27,1,45,2,94,2,40,2,60,2,40,2,66,2,54,1,42,2,67,1,25,1,15,2,40,2,48,1,37,2,14,2,48,2,48,1,91,2,16,1,129,2,14,1,51,2,46,1,53,1,24,1,10,1,73,1,59,1,43,1,59,2,62,1,79,1,69,2,30,2,72,1,45,2,70,2,68,2,14,1,51,2,70,1,51,1,41,1,43,1,43,1,59,2,40,1,3,1,47,1,67,2,34,1,51,2,74,1,51,1,37,1,71,2,58,2,72,2,52,2,52,1,73,2,86,2,16,1,59,1,57,2,102,2,68,1,19,1,33,2,38,1,41,2,40,2,42,1,43,2,52,1,33,2,40,2,8,1,97,2,12,2,11,1,11,1,40,2,8,1,29,1,45,1,37,1,33,1,31,1,59,2,2,2,34,1,19,2,50,3,45,1,97,2,28,2,52,2,54,1,15,2,14,1,13,2,29,1,30,1,33,1,45,1,35,1,35,1,33,1,2,1,34,2,40,1,57,2,42,1,71,2,40,1,23,2,40,2,44,1,33,1,8,1,12,2,22,1,5,2,54,1,83,1,33,2,48,1,45,2,84,1,71,2,40,2,6,1,55,2,62,3,43,2,62,1,47,2,34,2,20,2,50,2,45,1,6,2,34,2,20,1,69,2,46,2,44,2,27,3,50,2,38,1,17,1,77,1,31,2,38,1,45,2,22,2,66,2,52,1,33,1,19,1,33,2,46,2,48,1,17,1,55,1,25,1,19,2,54,1,73,1,91,1,67,1,5,2,54,1,49,1,43,2,38,2,54,1,70,1,56,1,43,1,87,2,14,1,43,1,37,1,61,2,12,1,67,2,28,1,27,2,38,1,37,4,46,2,12,2,18,2,54,2,40,1,3,2,19,1,42,1,21,2,92,2,46,1,55,2,16,1,36,1,30,1,41,1,31,2,40,2,34,2,24,2,18,2,44,1,37,2,4,2,56,1,21,1,37,1,37,2,12,1,33,2,64,2,30,1,23,1,17,2,40,2,70,2,18,1,35,2,24,4,54,1,29,2,22,2,40,2,78,2,46,2,30,2,26,1,9,2,74,1,1,2,64,2,36,1,57,2,48,1,7,1,13,1,39,1,41,1,29,2,20,2,16,1,59,2,32,2,38,1,11,1,27,1,23,2,38,1,19,2,52,1,67,2,116,1,21,2,46,2,50,1,69,2,42,2,38,1,23,2,2,1,43,2,58,1,8,1,42,1,51,1,55,2,26,2,40,2,46,2,60,1,39,2,22,1,41,1,45,1,35,2,72,2,60,2,30,1,45,1,39,1,47,2,42,2,38,1,41,1,43,1,67,2,46,2,54,2,54,2,64,1,69,1,35,1,21,2,54,4,30,1,35,1,19,2,40,1,69,1,35,1,15,2,50,2,62,1,37,1,21,1,59,2,98,1,53,2,10,2,58,2,20,2,34,2,2,1,27,2,62,1,39,2,22,1,51,1,27,1,13,1,53,2,34,2,12,1,25,1,31,1,5,2,8,1,45,1,11,1,49,2,50,2,42,1,17,2,26,2,52,1,27,2,22,1,9,2,56,1,41,1,29,1,69,2,48,2,54,2,38,2,50,2,38,1,47,1,31,1,43,1,47,2,56,1,37,1,19,1,33,1,43,1,51,1,13,2,54,1,35,2,26,2,2,1,35,1,9,2,48,1,38,3,58,1,35,2,22,1,5,2,66,2,40,1,11,1,55,2,82,2,54,2,18,1,19,2,32,2,57,1,28,1,9,1,43,1,31,2,34,2,50,1,21,2,44,1,49,2,76,2,44,1,61,1,29,1,43,2,32,2,52,2,46,1,57,1,53,1,57,2,54,2,24,2,58,1,49,2,50,1,41,2,50,1,37,2,54,2,76,2,62,2,22,1,33,1,31,1,47,1,11,2,40,2,24,1,27,2,42,1,53,2,36,2,14,2,70,2,16,2,48,1,31,1,55,2,26,1,49,1,57,1,49,1,49,1,55,1,37,2,32,2,56,2,1,1,42,1,43,2,22,2,26,2,32,2,60,1,47,1,55,1,27,1,31,2,34,2,38,2,60,2,40,2,54,2,46,1,73,1,51,2,46,2,36,1,7,1,45,2,42,1,42,1,58,1,31,1,27,1,31,1,59,1,47,2,20,2,50,2,10,2,38,1,41,1,11,1,43,2,62,1,45,1,41,1,23,2,46,1,47,1,39,1,47,1,55,2,68,1,53,1,37,2,32,2,30,3,43,2,72,2,50,1,15,1,47,2,52,1,31,2,66,2,56,2,52,2,60,2,100]",
"swapsFlips2_0":"656/[654,106,73,83,126,80,42,51,70,66,28,88,47,61,37,5,35,116,43,116,34,71,68,60,41,87,62,18,73,81,62,66,27,5,101,77,74,73,53,59,53,47,56,51,68,51,136,60,65,68,54,58,92,79,63,4,41,75,20,64,15,67,36,28,64,46,34,44,103,53,28,13,58,50,55,76,51,18,44,15,22,32,53,51,54,29,22,81,73,38,37,88,39,75,71,23,25,48,63,77,72,72,59,77,56,106,64,60,60,64,31,67,54,41,20,48,50,61,47,20,45,1,88,70,57,34,60,40,69,29,58,11,48,16,18,22,41,59,61,50,20,26,27,45,94,40,60,40,66,54,42,67,25,15,40,48,37,14,48,48,91,16,129,14,51,46,53,24,10,73,59,43,59,62,79,69,30,72,45,70,68,14,51,70,51,41,43,43,59,40,3,47,67,34,51,74,51,37,71,58,72,52,52,73,86,16,59,57,102,68,19,33,38,41,40,42,43,52,33,40,8,97,12,11,11,40,8,29,45,37,33,31,59,2,34,19,50,45,97,28,52,54,15,14,13,29,30,33,45,35,35,33,2,34,40,57,42,71,40,23,40,44,33,8,12,22,5,54,83,33,48,45,84,71,40,6,55,62,43,62,47,34,20,50,45,6,34,20,69,46,44,27,50,38,17,77,31,38,45,22,66,52,33,19,33,46,48,17,55,25,19,54,73,91,67,5,54,49,43,38,54,70,56,43,87,14,43,37,61,12,67,28,27,38,37,46,12,18,54,40,3,19,42,21,92,46,55,16,36,30,41,31,40,34,24,18,44,37,4,56,21,37,37,12,33,64,30,23,17,40,70,18,35,24,54,29,22,40,78,46,30,26,9,74,1,64,36,57,48,7,13,39,41,29,20,16,59,32,38,11,27,23,38,19,52,67,116,21,46,50,69,42,38,23,2,43,58,8,42,51,55,26,40,46,60,39,22,41,45,35,72,60,30,45,39,47,42,38,41,43,67,46,54,54,64,69,35,21,54,30,35,19,40,69,35,15,50,62,37,21,59,98,53,10,58,20,34,2,27,62,39,22,51,27,13,53,34,12,25,31,5,8,45,11,49,50,42,17,26,52,27,22,9,56,41,29,69,48,54,38,50,38,47,31,43,47,56,37,19,33,43,51,13,54,35,26,2,35,9,48,38,58,35,22,5,66,40,11,55,82,54,18,19,32,57,28,9,43,31,34,50,21,44,49,76,44,61,29,43,32,52,46,57,53,57,54,24,58,49,50,41,50,37,54,76,62,22,33,31,47,11,40,24,27,42,53,36,14,70,16,48,31,55,26,49,57,49,49,55,37,32,56,1,42,43,22,26,32,60,47,55,27,31,34,38,60,40,54,46,73,51,46,36,7,45,42,42,58,31,27,31,59,47,20,50,10,38,41,11,43,62,45,41,23,46,47,39,47,55,68,53,37,32,30,43,72,50,15,47,52,31,66,56,52,60,100]",
"swapsFlips2_1":"544/[5,1,2,3,2,2,1,-3,2,-4,1,14,2,1,2,2,1,2,2,1,1,2,2,1,1,2,2,-3,1,0,2,-4,1,3,2,1,2,1,-2,2,0,1,-2,2,8,1,1,2,1,1,2,2,1,1,-5,2,23,1,1,2,1,2,2,1,2,1,2,2,1,2,2,1,1,2,1,2,1,1,2,1,2,-4,1,6,2,1,1,2,2,1,1,-5,2,3,1,1,2,1,-2,2,2,1,1,2,-4,1,-2,2,3,1,1,2,1,-3,2,-2,1,-2,2,-1,1,-5,2,6,1,2,1,1,2,2,1,-2,2,5,1,2,1,2,1,2,-6,1,5,2,1,1,2,2,1,-2,2,1,1,2,-4,1,0,2,-2,1,2,2,1,2,-2,1,-3,2,23,1,2,2,1,1,2,2,1,1,2,1,2,2,1,2,1,2,2,1,2,2,1,1,2,-5,1,5,2,2,1,2,3,1,-2,2,3,1,2,1,2,-7,1,7,2,1,2,1,2,1,2,2,-2,1,15,2,1,2,1,1,2,1,2,1,2,2,1,2,3,2,1,-3,2,3,1,2,2,1,-2,2,1,3,2,-2,1,1,2,1,-2,2,-2,1,-1,2,-3,1,0,2,-3,1,4,2,1,1,2,2,-3,1,0,2,-2,1,6,2,1,2,1,2,1,4,-3,2,7,1,2,1,1,2,2,1,2,-3,1,-4,2,2,1,2,2,-2,1,5,2,1,2,2,1,1,-2,2,3,1,2,4,1,-5,2,6,1,2,1,2,2,1,2,-4,1,4,2,2,1,2,2,-2,1,14,2,1,2,1,2,1,2,2,1,2,2,1,2,1,2,-3,1,-3,2,1,1,2,-2,1,-2,2,-2,1,-1,2,-2,1,-3,2,-2,1,4,2,4,1,1,2,-2,1,-1,2,-2,1,1,2,1,-4,2,3,1,2,1,2,-3,1,-1,2,-2,1,0,2,-2,1,8,2,2,1,2,2,1,2,1,2,-2,1,-4,2,-3,1,0,2,-5,1,15,2,1,2,2,1,1,2,1,3,1,2,1,2,2,1,1,-2,2,2,1,2,2,-3,1,6,2,2,1,2,1,2,2,-2,1,-2,2,-2,1,-2,2,4,1,2,1,2,1,-3,2,-3,1,4,2,2,1,2,1,-4,2,2,1,1,2,-5,1,-2,2,-1,1,-3,2,-3,1,-5,2,-1,1,-1,2,2,1,1,2,-6,1,-3,2,-2,1,0,2,-2,1,0,2,-3,1,11,2,1,1,2,2,3,2,2,1,1,2,1,-4,2]","code":[]}
*/

/*
{"maxLen":281,"BDDsize":8865,"BDDheight":40,"resultSlot":220,
"labels":["3J","3I","3H","3G","3F","3E","3D","3C","3B","3A","2J","2I","2H","2G","2F","2E","2D","2C","2B","2A","1J","1I","1H","1G","1F","1E","1D","1C","1B","1A","0J","0I","0H","0G","0F","0E","0D","0C","0B","0A"],"labelDeltas":[-7445,1],"thenOps+elseOps":2617,
"srcOps":2530,
"thenSwaps+thenFlips+elseSwaps+elseFlips":3920,
"swapsFlips":2613,
"swapsFlips2":"1309/[106,1,73,2,83,3,126,2,80,2,42,1,51,2,70,2,66,2,28,2,88,1,47,1,61,1,37,1,5,1,35,2,116,1,43,2,116,2,34,1,71,2,68,2,60,1,41,1,87,2,62,2,18,1,73,1,81,2,62,2,66,1,27,1,5,1,101,1,77,2,74,1,73,1,53,1,59,1,53,1,47,2,56,1,51,2,68,1,51,2,136,2,60,2,65,1,68,2,54,2,58,2,92,1,79,1,63,2,4,1,41,1,75,2,20,2,64,1,15,1,67,2,36,2,28,2,64,2,46,2,34,2,44,1,103,1,53,2,28,1,13,2,58,2,50,1,55,2,76,1,51,2,18,2,44,1,15,2,22,2,32,1,53,1,51,2,54,1,29,2,22,1,81,1,73,2,38,1,37,2,88,1,39,1,75,1,71,1,23,1,25,2,48,1,63,1,77,2,72,2,72,1,59,1,77,2,56,2,106,2,64,2,60,2,60,2,64,1,31,1,67,2,54,1,41,2,20,2,48,2,50,1,61,1,47,2,20,1,45,1,1,1,88,1,70,1,57,2,34,2,60,2,40,1,69,1,29,2,58,1,11,2,48,2,16,2,18,2,22,1,41,1,59,1,61,2,50,2,20,2,26,1,27,1,45,2,94,2,40,2,60,2,40,2,66,2,54,1,42,2,67,1,25,1,15,2,40,2,48,1,37,2,14,2,48,2,48,1,91,2,16,1,129,2,14,1,51,2,46,1,53,1,24,1,10,1,73,1,59,1,43,1,59,2,62,1,79,1,69,2,30,2,72,1,45,2,70,2,68,2,14,1,51,2,70,1,51,1,41,1,43,1,43,1,59,2,40,1,3,1,47,1,67,2,34,1,51,2,74,1,51,1,37,1,71,2,58,2,72,2,52,2,52,1,73,2,86,2,16,1,59,1,57,2,102,2,68,1,19,1,33,2,38,1,41,2,40,2,42,1,43,2,52,1,33,2,40,2,8,1,97,2,12,2,11,1,11,1,40,2,8,1,29,1,45,1,37,1,33,1,31,1,59,2,2,2,34,1,19,2,50,3,45,1,97,2,28,2,52,2,54,1,15,2,14,1,13,2,29,1,30,1,33,1,45,1,35,1,35,1,33,1,2,1,34,2,40,1,57,2,42,1,71,2,40,1,23,2,40,2,44,1,33,1,8,1,12,2,22,1,5,2,54,1,83,1,33,2,48,1,45,2,84,1,71,2,40,2,6,1,55,2,62,3,43,2,62,1,47,2,34,2,20,2,50,2,45,1,6,2,34,2,20,1,69,2,46,2,44,2,27,3,50,2,38,1,17,1,77,1,31,2,38,1,45,2,22,2,66,2,52,1,33,1,19,1,33,2,46,2,48,1,17,1,55,1,25,1,19,2,54,1,73,1,91,1,67,1,5,2,54,1,49,1,43,2,38,2,54,1,70,1,56,1,43,1,87,2,14,1,43,1,37,1,61,2,12,1,67,2,28,1,27,2,38,1,37,4,46,2,12,2,18,2,54,2,40,1,3,2,19,1,42,1,21,2,92,2,46,1,55,2,16,1,36,1,30,1,41,1,31,2,40,2,34,2,24,2,18,2,44,1,37,2,4,2,56,1,21,1,37,1,37,2,12,1,33,2,64,2,30,1,23,1,17,2,40,2,70,2,18,1,35,2,24,4,54,1,29,2,22,2,40,2,78,2,46,2,30,2,26,1,9,2,74,1,1,2,64,2,36,1,57,2,48,1,7,1,13,1,39,1,41,1,29,2,20,2,16,1,59,2,32,2,38,1,11,1,27,1,23,2,38,1,19,2,52,1,67,2,116,1,21,2,46,2,50,1,69,2,42,2,38,1,23,2,2,1,43,2,58,1,8,1,42,1,51,1,55,2,26,2,40,2,46,2,60,1,39,2,22,1,41,1,45,1,35,2,72,2,60,2,30,1,45,1,39,1,47,2,42,2,38,1,41,1,43,1,67,2,46,2,54,2,54,2,64,1,69,1,35,1,21,2,54,4,30,1,35,1,19,2,40,1,69,1,35,1,15,2,50,2,62,1,37,1,21,1,59,2,98,1,53,2,10,2,58,2,20,2,34,2,2,1,27,2,62,1,39,2,22,1,51,1,27,1,13,1,53,2,34,2,12,1,25,1,31,1,5,2,8,1,45,1,11,1,49,2,50,2,42,1,17,2,26,2,52,1,27,2,22,1,9,2,56,1,41,1,29,1,69,2,48,2,54,2,38,2,50,2,38,1,47,1,31,1,43,1,47,2,56,1,37,1,19,1,33,1,43,1,51,1,13,2,54,1,35,2,26,2,2,1,35,1,9,2,48,1,38,3,58,1,35,2,22,1,5,2,66,2,40,1,11,1,55,2,82,2,54,2,18,1,19,2,32,2,57,1,28,1,9,1,43,1,31,2,34,2,50,1,21,2,44,1,49,2,76,2,44,1,61,1,29,1,43,2,32,2,52,2,46,1,57,1,53,1,57,2,54,2,24,2,58,1,49,2,50,1,41,2,50,1,37,2,54,2,76,2,62,2,22,1,33,1,31,1,47,1,11,2,40,2,24,1,27,2,42,1,53,2,36,2,14,2,70,2,16,2,48,1,31,1,55,2,26,1,49,1,57,1,49,1,49,1,55,1,37,2,32,2,56,2,1,1,42,1,43,2,22,2,26,2,32,2,60,1,47,1,55,1,27,1,31,2,34,2,38,2,60,2,40,2,54,2,46,1,73,1,51,2,46,2,36,1,7,1,45,2,42,1,42,1,58,1,31,1,27,1,31,1,59,1,47,2,20,2,50,2,10,2,38,1,41,1,11,1,43,2,62,1,45,1,41,1,23,2,46,1,47,1,39,1,47,1,55,2,68,1,53,1,37,2,32,2,30,3,43,2,72,2,50,1,15,1,47,2,52,1,31,2,66,2,56,2,52,2,60,2,100]",
"swapsFlips2_0":"656/max:136/[654,106,73,83,126,80,42,51,70,66,28,88,47,61,37,5,35,116,43,116,34,71,68,60,41,87,62,18,73,81,62,66,27,5,101,77,74,73,53,59,53,47,56,51,68,51,136,60,65,68,54,58,92,79,63,4,41,75,20,64,15,67,36,28,64,46,34,44,103,53,28,13,58,50,55,76,51,18,44,15,22,32,53,51,54,29,22,81,73,38,37,88,39,75,71,23,25,48,63,77,72,72,59,77,56,106,64,60,60,64,31,67,54,41,20,48,50,61,47,20,45,1,88,70,57,34,60,40,69,29,58,11,48,16,18,22,41,59,61,50,20,26,27,45,94,40,60,40,66,54,42,67,25,15,40,48,37,14,48,48,91,16,129,14,51,46,53,24,10,73,59,43,59,62,79,69,30,72,45,70,68,14,51,70,51,41,43,43,59,40,3,47,67,34,51,74,51,37,71,58,72,52,52,73,86,16,59,57,102,68,19,33,38,41,40,42,43,52,33,40,8,97,12,11,11,40,8,29,45,37,33,31,59,2,34,19,50,45,97,28,52,54,15,14,13,29,30,33,45,35,35,33,2,34,40,57,42,71,40,23,40,44,33,8,12,22,5,54,83,33,48,45,84,71,40,6,55,62,43,62,47,34,20,50,45,6,34,20,69,46,44,27,50,38,17,77,31,38,45,22,66,52,33,19,33,46,48,17,55,25,19,54,73,91,67,5,54,49,43,38,54,70,56,43,87,14,43,37,61,12,67,28,27,38,37,46,12,18,54,40,3,19,42,21,92,46,55,16,36,30,41,31,40,34,24,18,44,37,4,56,21,37,37,12,33,64,30,23,17,40,70,18,35,24,54,29,22,40,78,46,30,26,9,74,1,64,36,57,48,7,13,39,41,29,20,16,59,32,38,11,27,23,38,19,52,67,116,21,46,50,69,42,38,23,2,43,58,8,42,51,55,26,40,46,60,39,22,41,45,35,72,60,30,45,39,47,42,38,41,43,67,46,54,54,64,69,35,21,54,30,35,19,40,69,35,15,50,62,37,21,59,98,53,10,58,20,34,2,27,62,39,22,51,27,13,53,34,12,25,31,5,8,45,11,49,50,42,17,26,52,27,22,9,56,41,29,69,48,54,38,50,38,47,31,43,47,56,37,19,33,43,51,13,54,35,26,2,35,9,48,38,58,35,22,5,66,40,11,55,82,54,18,19,32,57,28,9,43,31,34,50,21,44,49,76,44,61,29,43,32,52,46,57,53,57,54,24,58,49,50,41,50,37,54,76,62,22,33,31,47,11,40,24,27,42,53,36,14,70,16,48,31,55,26,49,57,49,49,55,37,32,56,1,42,43,22,26,32,60,47,55,27,31,34,38,60,40,54,46,73,51,46,36,7,45,42,42,58,31,27,31,59,47,20,50,10,38,41,11,43,62,45,41,23,46,47,39,47,55,68,53,37,32,30,43,72,50,15,47,52,31,66,56,52,60,100]",
"swapsFlips2_1":"544/max:4/[5,1,2,3,2,2,1,-3,2,-4,1,14,2,1,2,2,1,2,2,1,1,2,2,1,1,2,2,-3,1,0,2,-4,1,3,2,1,2,1,-2,2,0,1,-2,2,8,1,1,2,1,1,2,2,1,1,-5,2,23,1,1,2,1,2,2,1,2,1,2,2,1,2,2,1,1,2,1,2,1,1,2,1,2,-4,1,6,2,1,1,2,2,1,1,-5,2,3,1,1,2,1,-2,2,2,1,1,2,-4,1,-2,2,3,1,1,2,1,-3,2,-2,1,-2,2,-1,1,-5,2,6,1,2,1,1,2,2,1,-2,2,5,1,2,1,2,1,2,-6,1,5,2,1,1,2,2,1,-2,2,1,1,2,-4,1,0,2,-2,1,2,2,1,2,-2,1,-3,2,23,1,2,2,1,1,2,2,1,1,2,1,2,2,1,2,1,2,2,1,2,2,1,1,2,-5,1,5,2,2,1,2,3,1,-2,2,3,1,2,1,2,-7,1,7,2,1,2,1,2,1,2,2,-2,1,15,2,1,2,1,1,2,1,2,1,2,2,1,2,3,2,1,-3,2,3,1,2,2,1,-2,2,1,3,2,-2,1,1,2,1,-2,2,-2,1,-1,2,-3,1,0,2,-3,1,4,2,1,1,2,2,-3,1,0,2,-2,1,6,2,1,2,1,2,1,4,-3,2,7,1,2,1,1,2,2,1,2,-3,1,-4,2,2,1,2,2,-2,1,5,2,1,2,2,1,1,-2,2,3,1,2,4,1,-5,2,6,1,2,1,2,2,1,2,-4,1,4,2,2,1,2,2,-2,1,14,2,1,2,1,2,1,2,2,1,2,2,1,2,1,2,-3,1,-3,2,1,1,2,-2,1,-2,2,-2,1,-1,2,-2,1,-3,2,-2,1,4,2,4,1,1,2,-2,1,-1,2,-2,1,1,2,1,-4,2,3,1,2,1,2,-3,1,-1,2,-2,1,0,2,-2,1,8,2,2,1,2,2,1,2,1,2,-2,1,-4,2,-3,1,0,2,-5,1,15,2,1,2,2,1,1,2,1,3,1,2,1,2,2,1,1,-2,2,2,1,2,2,-3,1,6,2,2,1,2,1,2,2,-2,1,-2,2,-2,1,-2,2,4,1,2,1,2,1,-3,2,-3,1,4,2,2,1,2,1,-4,2,2,1,1,2,-5,1,-2,2,-1,1,-3,2,-3,1,-5,2,-1,1,-1,2,2,1,1,2,-6,1,-3,2,-2,1,0,2,-2,1,0,2,-3,1,11,2,1,1,2,2,3,2,2,1,1,2,1,-4,2]","code":[]}
*/

