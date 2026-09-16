import ts from "typescript";

/** Select an existing UI export and its local dependencies, without copying it.
 * The preview never imports the rest of the desk or starts its server engine. */
export function selectComponent(source, filename, exportName) {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const bindings = new Map();
  for (const statement of file.statements) {
    if ((ts.isFunctionDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) && statement.name) {
      bindings.set(statement.name.text, statement);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) bindings.set(declaration.name.text, statement);
      }
    }
  }
  const root = bindings.get(exportName);
  if (!root) throw new Error(`Preview export ${exportName} is missing from ${filename}`);
  const selected = new Set();
  const identifiers = new Set();
  function include(statement) {
    if (selected.has(statement)) return;
    selected.add(statement);
    function walk(node) {
      if (ts.isIdentifier(node)) {
        identifiers.add(node.text);
        const dependency = bindings.get(node.text);
        if (dependency && dependency !== statement) include(dependency);
      }
      ts.forEachChild(node, walk);
    }
    walk(statement);
  }
  include(root);
  const printer = ts.createPrinter();
  const output = [];
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement) && statement.importClause) {
      const clause = statement.importClause;
      const name = clause.name && identifiers.has(clause.name.text) ? clause.name : undefined;
      const named = clause.namedBindings;
      const filtered = named && ts.isNamedImports(named)
        ? ts.factory.updateNamedImports(named, named.elements.filter(element => identifiers.has(element.name.text)))
        : named && identifiers.has(named.name.text) ? named : undefined;
      const hasNamed = filtered && (!ts.isNamedImports(filtered) || filtered.elements.length > 0);
      if (!name && !hasNamed) continue;
      const updated = ts.factory.updateImportDeclaration(statement, statement.modifiers,
        ts.factory.updateImportClause(clause, clause.isTypeOnly, name, hasNamed ? filtered : undefined),
        statement.moduleSpecifier, statement.attributes);
      output.push(printer.printNode(ts.EmitHint.Unspecified, updated, file));
    } else if (selected.has(statement)) {
      const alreadyExported = statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);
      output.push((statement === root && !alreadyExported ? "export " : "") + statement.getText(file));
    }
  }
  return output.join("\n\n");
}
