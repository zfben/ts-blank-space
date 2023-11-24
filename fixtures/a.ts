let x /**/: number/**/ = 1!;
//        ^^^^^^^^        ^

[] as [] satisfies [];
// ^^^^^^^^^^^^^^^^^^

class C /**/< T >/*︎*/ extends Array/**/<T> /*︎*/implements I,J/*︎*/ {
//          ^^^^^                      ^^^     ^^^^^^^^^^^^^^
    readonly field/**/: string/**/ = "";
//  ^^^^^^^^          ^^^^^^^^
    static accessor f1;
    private f2/**/!/**/: string/*︎*/;
//  ^^^^^^^       ^    ^^^^^^^^
    declare f3: any;
//  ^^^^^^^^^^^^^^^^ declared property

    public method/**/<T>/*︎*/(/*︎*/this: T,/**/ a? /*︎*/: string/**/)/*︎*/: void/*︎*/ {
//  ^^^^^^           ^^^         ^^^^^^^^      ^     ^^^^^^^^         ^^^^^^
    }
}

class D extends C<any> {
//               ^^^^^
    override method(...args): any {}
//  ^^^^^^^^                ^^^^^
}

/** @doc */
interface I {}
// ^^^^^^^^^^^ interface

void 0;

/** @doc */
type J = I;
// ^^^^^^^^ type alias

/**/import type T from "node:assert";
//  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

/**/export type { I };
//  ^^^^^^^^^^^^^^^^^^

/**/export type * from "node:buffer";
//  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

import {type AssertPredicate/**/, deepEqual} from "node:assert";
//      ^^^^^^^^^^^^^^^^^^^^^^^^^

export {
    C,
    type T,
//  ^^^^^^
}

/**/export type T2 = 1;
//  ^^^^^^^^^^^^^^^^^^^

function foo<T>(p: any = (): any => 1): any {
//          ^^^  ^^^^^     ^^^^^      ^^^^^
    return p as any;
//           ^^^^^^
}

/**/declare enum E1 {}
//  ^^^^^^^^^^^^^^^^^^ enum

void 0;

/**/declare namespace N {}
//  ^^^^^^^^^^^^^^^^^^^^^^ namespace

void 0;

/**/declare module M {}
//  ^^^^^^^^^^^^^^^^^^^ module

void 0;
