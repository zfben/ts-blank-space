// Copyright 2024 Bloomberg Finance L.P.
// Distributed under the terms of the Apache 2.0 license.

import type * as ts from "typescript";
import tslib from "typescript";
import BlankString from "./blank-string.js";
const SK = tslib.SyntaxKind;

// These values must be 'falsey' to not stop TypeScript's walk
const VISIT_BLANKED = "";
const VISITED_JS = null;

type VisitResult = typeof VISIT_BLANKED | typeof VISITED_JS;
type ErrorCb = (n: ts.Node) => void;

const languageOptions: ts.CreateSourceFileOptions = {
    languageVersion: tslib.ScriptTarget.ESNext,
    impliedNodeFormat: tslib.ModuleKind.ESNext,
};

const scanner = tslib.createScanner(tslib.ScriptTarget.ESNext, /*skipTrivia: */ true, tslib.LanguageVariant.Standard);
if (tslib.JSDocParsingMode) {
    // TypeScript >= 5.3
    languageOptions.jsDocParsingMode = tslib.JSDocParsingMode.ParseNone;
    scanner.setJSDocParsingMode(tslib.JSDocParsingMode.ParseNone);
}

// State is hoisted to module scope so we can avoid creating per-run closures
let src = "";
let str = new BlankString("");
let ast: ts.SourceFile;
let onError: ErrorCb | undefined;
let seenJS = false;
let missingSemiPos = 0;

/**
 * @param input string containing TypeScript
 * @param onErrorArg callback when unsupported syntax is encountered
 * @returns the resulting JavaScript
 */
export default function tsBlankSpace(input: string, onErrorArg?: ErrorCb): string {
    return blankSourceFile(
        tslib.createSourceFile("input.ts", input, languageOptions, /* setParentNodes: */ false, tslib.ScriptKind.TS),
        onErrorArg,
    );
}

/**
 * @param source containing TypeScript's AST
 * @param onErrorArg callback when unsupported syntax is encountered
 * @returns the resulting JavaScript
 */
export function blankSourceFile(source: ts.SourceFile, onErrorArg?: ErrorCb): string {
    try {
        const input = source.getFullText(source);
        src = input;
        str = new BlankString(input);
        onError = onErrorArg;
        scanner.setText(input);
        ast = source;

        ast.forEachChild(visitTop);

        return str.toString();
    } finally {
        // Cleanup. Release memory. Reset state.
        scanner.setText("");
        onError = undefined;
        ast = undefined!;
        str = undefined!;
        src = "";
        seenJS = false;
        missingSemiPos = 0;
    }
}

function visitTop(node: ts.Node): void {
    if (innerVisitTop(node) === VISITED_JS) {
        seenJS = true;
    }
}

function innerVisitTop(node: ts.Node): VisitResult {
    const n = node as any;
    switch (node.kind) {
        case SK.ImportDeclaration:
            return visitImportDeclaration(n);
        case SK.ExportDeclaration:
            return visitExportDeclaration(n);
        case SK.ExportAssignment:
            return visitExportAssignment(n);
        case SK.ImportEqualsDeclaration:
            onError && onError(n);
            return VISITED_JS;
    }
    return visitor(node);
}

function visitor(node: ts.Node): VisitResult {
    const r = innerVisitor(node);
    if (r === VISITED_JS) {
        seenJS = true;
    }
    return r;
}

function innerVisitor(node: ts.Node): VisitResult {
    const n = node as any;
    // prettier-ignore
    switch (node.kind) {
        case SK.Identifier: return VISITED_JS;
        case SK.ExpressionStatement: return visitExpressionStatement(n);
        case SK.VariableDeclaration: return visitVariableDeclaration(n);
        case SK.VariableStatement: return visitVariableStatement(n);
        case SK.CallExpression:
        case SK.NewExpression: return visitCallOrNewExpression(n);
        case SK.TypeAliasDeclaration:
        case SK.InterfaceDeclaration: blankStatement(n); return VISIT_BLANKED;
        case SK.ClassDeclaration:
        case SK.ClassExpression: return visitClassLike(n);
        case SK.ExpressionWithTypeArguments: return visitExpressionWithTypeArguments(n);
        case SK.PropertyDeclaration: return visitPropertyDeclaration(n);
        case SK.NonNullExpression: return visitNonNullExpression(n);
        case SK.SatisfiesExpression:
        case SK.AsExpression: return visitTypeAssertion(n);
        case SK.ArrowFunction:
        case SK.FunctionDeclaration:
        case SK.MethodDeclaration:
        case SK.Constructor:
        case SK.FunctionExpression:
        case SK.GetAccessor:
        case SK.SetAccessor: return visitFunctionLikeDeclaration(n);
        case SK.EnumDeclaration:
        case SK.ModuleDeclaration: return visitEnumOrModule(n);
        case SK.IndexSignature: blankExact(n); return VISIT_BLANKED;
        case SK.TaggedTemplateExpression: return visitTaggedTemplate(n);
        case SK.TypeAssertionExpression: return visitLegacyTypeAssertion(n);
    }

    return node.forEachChild(visitor) || VISITED_JS;
}

function visitExpressionStatement(node: ts.ExpressionStatement): VisitResult {
    if (src.charCodeAt(node.end) !== 59 /* ; */) {
        missingSemiPos = node.end;
    }
    return visitor(node.expression);
}

/**
 * `let x : T` (outer)
 */
function visitVariableStatement(node: ts.VariableStatement): VisitResult {
    if (node.modifiers && modifiersContainsDeclare(node.modifiers)) {
        blankStatement(node);
        return VISIT_BLANKED;
    }
    node.forEachChild(visitor);
    return VISITED_JS;
}

/**
 * `new Set<string>()` | `foo<string>()`
 */
function visitCallOrNewExpression(node: ts.NewExpression | ts.CallExpression): VisitResult {
    visitor(node.expression);
    if (node.typeArguments) {
        blankGenerics(node, node.typeArguments);
    }
    if (node.arguments) {
        for (let i = 0; i < node.arguments.length; i++) {
            visitor(node.arguments[i]);
        }
    }
    return VISITED_JS;
}

/**
 * foo<T>`tagged template`
 */
function visitTaggedTemplate(node: ts.TaggedTemplateExpression): VisitResult {
    visitor(node.tag);
    if (node.typeArguments) {
        blankGenerics(node, node.typeArguments);
    }
    visitor(node.template);
    return VISITED_JS;
}

/**
 * `let x : T = v` (inner)
 */
function visitVariableDeclaration(node: ts.VariableDeclaration): VisitResult {
    visitor(node.name);

    // let x!
    node.exclamationToken && blankExact(node.exclamationToken);

    // let x: T
    node.type && blankTypeNode(node.type);

    // let x = v
    if (node.initializer) {
        visitor(node.initializer);
    }
    return VISITED_JS;
}

/**
 * `class ...`
 */
function visitClassLike(node: ts.ClassLikeDeclaration): VisitResult {
    if (node.modifiers) {
        if (modifiersContainsDeclare(node.modifiers)) {
            blankStatement(node);
            return VISIT_BLANKED;
        }
        visitModifiers(node.modifiers);
    }

    // ... <T>
    if (node.typeParameters && node.typeParameters.length) {
        blankGenerics(node, node.typeParameters);
    }

    const { heritageClauses } = node;
    if (heritageClauses) {
        for (let i = 0; i < heritageClauses.length; i++) {
            const hc = heritageClauses[i];
            // implements T
            if (hc.token === SK.ImplementsKeyword) {
                blankExact(hc);
            }
            // ... extends C<T> ...
            else if (hc.token === SK.ExtendsKeyword) {
                hc.forEachChild(visitor);
            }
        }
    }
    node.members.forEach(visitor);
    return VISITED_JS;
}

/**
 * Exp<T>
 */
function visitExpressionWithTypeArguments(node: ts.ExpressionWithTypeArguments): VisitResult {
    visitor(node.expression);
    if (node.typeArguments) {
        blankGenerics(node, node.typeArguments);
    }
    return VISITED_JS;
}

function visitModifiers(modifiers: ArrayLike<ts.ModifierLike>): void {
    for (let i = 0; i < modifiers.length; i++) {
        const modifier = modifiers[i];
        switch (modifier.kind) {
            case SK.PrivateKeyword:
            case SK.ProtectedKeyword:
            case SK.PublicKeyword:
            case SK.AbstractKeyword:
            case SK.OverrideKeyword:
            case SK.DeclareKeyword:
            case SK.ReadonlyKeyword:
                blankExact(modifier);
                continue;
            case SK.Decorator:
                visitor(modifier);
                continue;
        }

        // at runtime skip the remaining checks
        // these are here only as a compile-time exhaustive check
        const trueAsFalse = /** @type {false} */ true;
        if (trueAsFalse) continue;

        switch (modifier.kind) {
            case SK.ConstKeyword:
            case SK.DefaultKeyword:
            case SK.ExportKeyword:
            case SK.InKeyword:
            case SK.StaticKeyword:
            case SK.AccessorKeyword:
            case SK.AsyncKeyword:
            case SK.OutKeyword:
                continue;
            default:
                never(modifier);
        }
    }
}

/**
 * prop: T
 */
function visitPropertyDeclaration(node: ts.PropertyDeclaration): VisitResult {
    if (node.modifiers) {
        if (modifiersContainsAbstractOrDeclare(node.modifiers)) {
            blankStatement(node);
            return VISIT_BLANKED;
        }
        visitModifiers(node.modifiers);
    }
    node.exclamationToken && blankExact(node.exclamationToken);
    node.questionToken && blankExact(node.questionToken);
    node.type && blankTypeNode(node.type);

    visitor(node.name);

    if (node.initializer) {
        visitor(node.initializer);
    }
    return VISITED_JS;
}

/**
 * `expr!`
 */
function visitNonNullExpression(node: ts.NonNullExpression): VisitResult {
    visitor(node.expression);
    str.blank(node.end - 1, node.end);
    return VISITED_JS;
}

/**
 * `exp satisfies T, exp as T`
 */
function visitTypeAssertion(node: ts.SatisfiesExpression | ts.AsExpression): VisitResult {
    const r = visitor(node.expression);
    if (node.end === missingSemiPos) {
        str.blankButStartWithSemi(node.expression.end, node.end);
    } else {
        str.blank(node.expression.end, node.end);
    }
    return r;
}

/**
 * `<type>v`
 */
function visitLegacyTypeAssertion(node: ts.TypeAssertion): VisitResult {
    onError && onError(node);
    return visitor(node.expression);
}

/**
 * `function<T>(p: T): T {}`
 */
function visitFunctionLikeDeclaration(node: ts.FunctionLikeDeclaration): VisitResult {
    if (!node.body) {
        if (node.modifiers && modifiersContainsDeclare(node.modifiers)) {
            blankStatement(node);
            return VISIT_BLANKED;
        }
        // else: overload
        blankExact(node);
        return VISIT_BLANKED;
    }

    if (node.modifiers) {
        visitModifiers(node.modifiers);
    }

    if (node.name) {
        visitor(node.name);
    }

    if (node.typeParameters && node.typeParameters.length) {
        blankGenerics(node, node.typeParameters);
    }

    // method?
    node.questionToken && blankExact(node.questionToken);

    for (let i = 0; i < node.parameters.length; i++) {
        const p = node.parameters[i];
        if (i === 0 && p.name.getText(ast) === "this") {
            blankExactAndOptionalTrailingComma(p);
            continue;
        }
        if (p.modifiers) {
            // error on non-standard parameter properties
            for (let i = 0; i < p.modifiers.length; i++) {
                const mod = p.modifiers[i];
                switch (mod.kind) {
                    case SK.PublicKeyword:
                    case SK.ProtectedKeyword:
                    case SK.PrivateKeyword:
                    case SK.ReadonlyKeyword:
                        onError && onError(mod);
                }
            }
        }
        visitor(p.name);
        p.questionToken && blankExact(p.questionToken);
        p.type && blankTypeNode(p.type);
        p.initializer && visitor(p.initializer);
    }

    const returnType = node.type;
    const isArrow = node.kind === SK.ArrowFunction;
    if (returnType) {
        if (!isArrow || !spansLines(node.parameters.end, node.equalsGreaterThanToken.pos)) {
            blankTypeNode(returnType);
        } else {
            // danger! new line between parameters and `=>`
            const paramEnd = getClosingParenthesisPos(node.parameters);
            str.blankButEndWithCloseParen(paramEnd - 1, returnType.getEnd());
        }
    }

    const body = node.body;
    if (body.kind === SK.Block) {
        const statements = (body as ts.Block).statements;
        const cache = seenJS;
        seenJS = false;
        for (let i = 0; i < statements.length; i++) {
            if (visitor(statements[i]) === VISITED_JS) {
                seenJS = true;
            }
        }
        seenJS = cache;
    } else {
        visitor(node.body);
    }
    return VISITED_JS;
}

function spansLines(a: number, b: number): boolean {
    for (let i = a; i < b; i++) {
        if (src.charCodeAt(i) === 10 /* \n */) return true;
    }
    return false;
}

/**
 * `import ...`
 */
function visitImportDeclaration(node: ts.ImportDeclaration): VisitResult {
    if (node.importClause) {
        if (node.importClause.isTypeOnly) {
            blankStatement(node);
            return VISIT_BLANKED;
        }
        const { namedBindings } = node.importClause;
        if (namedBindings && tslib.isNamedImports(namedBindings)) {
            const elements = namedBindings.elements;
            for (let i = 0; i < elements.length; i++) {
                const e = elements[i];
                e.isTypeOnly && blankExactAndOptionalTrailingComma(e);
            }
        }
    }
    return VISITED_JS;
}

/**
 * `export ...`
 */
function visitExportDeclaration(node: ts.ExportDeclaration): VisitResult {
    if (node.isTypeOnly) {
        blankStatement(node);
        return VISIT_BLANKED;
    }

    const { exportClause } = node;
    if (exportClause && tslib.isNamedExports(exportClause)) {
        const elements = exportClause.elements;
        for (let i = 0; i < elements.length; i++) {
            const e = elements[i];
            e.isTypeOnly && blankExactAndOptionalTrailingComma(e);
        }
    }
    return VISITED_JS;
}

/**
 * `export default ...`
 */
function visitExportAssignment(node: ts.ExportAssignment): VisitResult {
    if (node.isExportEquals) {
        // `export = ...`
        onError && onError(node);
        return VISITED_JS;
    }
    visitor(node.expression);
    return VISITED_JS;
}

function visitEnumOrModule(node: ts.EnumDeclaration | ts.ModuleDeclaration): VisitResult {
    if (node.modifiers && modifiersContainsDeclare(node.modifiers)) {
        blankStatement(node);
        return VISIT_BLANKED;
    } else {
        onError && onError(node);
        return VISITED_JS;
    }
}

function modifiersContainsDeclare(modifiers: ArrayLike<ts.ModifierLike>): boolean {
    for (let i = 0; i < modifiers.length; i++) {
        const modifier = modifiers[i];
        if (modifier.kind === SK.DeclareKeyword) {
            return true;
        }
    }
    return false;
}

function modifiersContainsAbstractOrDeclare(modifiers: ArrayLike<ts.ModifierLike>): boolean {
    for (let i = 0; i < modifiers.length; i++) {
        const modifierKind = modifiers[i].kind;
        if (modifierKind === SK.AbstractKeyword || modifierKind === SK.DeclareKeyword) {
            return true;
        }
    }
    return false;
}

function scanRange<T>(start: number, end: number, callback: () => T): T {
    return scanner.scanRange(start, /* length: */ end - start, callback);
}

function endPosOfToken(token: ts.SyntaxKind): number {
    let first = true;
    let start = 0;
    while (true) {
        const next = scanner.scan();
        if (first) {
            start = scanner.getTokenStart();
            first = false;
        }
        if (next === token) break;
        if (next === SK.EndOfFileToken) {
            // We should always find the token we are looking for
            // if we don't, return the start of where we started searching from
            return start;
        }
    }
    return scanner.getTokenEnd();
}

/** > */
function getGreaterThanToken() {
    return endPosOfToken(SK.GreaterThanToken);
}

/** ) */
function getClosingParen() {
    return endPosOfToken(SK.CloseParenToken);
}

function blankTypeNode(n: ts.TypeNode): void {
    // -1 for `:`
    str.blank(n.getFullStart() - 1, n.end);
}

function blankExact(n: ts.Node): void {
    str.blank(n.getStart(ast), n.end);
}

function blankStatement(n: ts.Node): void {
    if (seenJS) {
        str.blankButStartWithSemi(n.getStart(ast), n.end);
    } else {
        str.blank(n.getStart(ast), n.end);
    }
}

function blankExactAndOptionalTrailingComma(n: ts.Node): void {
    scanner.resetTokenState(n.end);
    const trailingComma = scanner.scan() === SK.CommaToken;
    str.blank(n.getStart(ast), trailingComma ? scanner.getTokenEnd() : n.end);
}

/**
 * `<T1, T2>`
 */
function blankGenerics(node: ts.Node, arr: ts.NodeArray<ts.Node>): void {
    const start = arr.pos - 1;
    const end = scanRange(arr.end, node.end, getGreaterThanToken);
    str.blank(start, end);
}

function getClosingParenthesisPos(node: ts.NodeArray<ts.ParameterDeclaration>): number {
    return scanRange(node.length === 0 ? node.pos : node[node.length - 1].end, ast.end, getClosingParen);
}

function never(n: never): never {
    throw new Error("unreachable code was reached");
}
