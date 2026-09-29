import { ruleTester } from '../../src/engine/rule-tester.js';
import rule from './index.js';
import { cases } from './cases.js';

ruleTester(rule, cases);
