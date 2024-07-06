import { map } from "../common/map.ts" 
import { nullTag } from "../common/null.ts" 
import { seq } from "../common/seq.ts" 
import { string } from "../common/string.ts" 
import { binary } from "./binary.ts" 
import { falseTag, trueTag } from "./bool.ts" 
import { float, floatExp, floatNaN } from "./float.ts" 
import { intBin, int, intHex, intOct } from "./int.ts" 
import { omap } from "./omap.ts" 
import { pairs } from "./pairs.ts" 
import { set } from "./set.ts" 
import { intTime, floatTime, timestamp } from "./timestamp.ts" 

export const schema = [
  map,
  seq,
  string,
  nullTag,
  trueTag,
  falseTag,
  intBin,
  intOct,
  int,
  intHex,
  floatNaN,
  floatExp,
  float,
  binary,
  omap,
  pairs,
  set,
  intTime,
  floatTime,
  timestamp
]
