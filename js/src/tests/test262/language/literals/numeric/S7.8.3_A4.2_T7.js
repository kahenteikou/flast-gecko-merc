// Copyright 2009 the Sputnik authors.  All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
info: "ExponentPart :: ExponentIndicator ( /+/-) 0 DecimalDigits is allowed"
es5id: 7.8.3_A4.2_T7
description: "ExponentIndicator :: e"
---*/

//CHECK#0
if (0e00 !== 0) {
  throw new Test262Error('#0: 0e00 === 0');
}

//CHECK#1
if (1e00 !== 1) {
  throw new Test262Error('#1: 1e00 === 1');
}

//CHECK#2
if (2e00 !== 2) {
  throw new Test262Error('#2: 2e00 === 2');
}

//CHECK#3
if (3e00 !== 3) {
  throw new Test262Error('#3: 3e00 === 3');
}

//CHECK#4
if (4e00 !== 4) {
  throw new Test262Error('#4: 4e00 === 4');
}

//CHECK#5
if (5e00 !== 5) {
  throw new Test262Error('#5: 5e00 === 5');
}

//CHECK#6
if (6e00 !== 6) {
  throw new Test262Error('#6: 6e00 === 6');
}

//CHECK#7
if (7e00 !== 7) {
  throw new Test262Error('#7: 7e00 === 7');
}

//CHECK#8
if (8e00 !== 8) {
  throw new Test262Error('#8: 8e00 === 8');
}

//CHECK#9
if (9e00 !== 9) {
  throw new Test262Error('#9: 9e00 === 9');
}

reportCompare(0, 0);
