import { Scalar } from "../../nodes/Scalar.ts" 
import { stringifyNumber } from "../../stringify/stringifyNumber.ts" 
import type { ScalarTag } from "../types.ts" 

export const floatNaN: ScalarTag = {
  identify: value => typeof value === 'number',
  default: true,
  tag: 'tag:yaml.org,2002:float',
  test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
  resolve: str =>
    str.slice(-3).toLowerCase() === 'nan'
      ? NaN
      : str[0] === '-'
        ? Number.NEGATIVE_INFINITY
        : Number.POSITIVE_INFINITY,
  stringify: stringifyNumber
}

export const floatExp: ScalarTag = {
  identify: value => typeof value === 'number',
  default: true,
  tag: 'tag:yaml.org,2002:float',
  format: 'EXP',
  test: /^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)[eE][-+]?[0-9]+$/,
  resolve: str => parseFloat(str),
  stringify(node) {
    const num = Number(node.value)
    return isFinite(num) ? num.toExponential() : stringifyNumber(node)
  }
}

export const float: ScalarTag = {
  identify: value => typeof value === 'number',
  default: true,
  tag: 'tag:yaml.org,2002:float',
  test: /^[-+]?(?:\.[0-9]+|[0-9]+\.[0-9]*)$/,
  resolve(str) {
    const node = new Scalar(parseFloat(str))
    const dot = str.indexOf('.')
    if (dot !== -1 && str[str.length - 1] === '0')
      node.minFractionDigits = str.length - dot - 1
    return node
  },
  stringify: stringifyNumber
}
