var assert = require('assert');
var util = require('util');
var types = require('./types');

function Context(returnType, variableTypes) {
	this.returnType = returnType;
	this.variableTypes = variableTypes;
}
Context.prototype.copy = function() {
	var variableTypes = {};
	for (var prop in this.variableTypes) {
		variableTypes[prop] = this.variableTypes[prop];
	}
	return new Context(this.returnType, variableTypes);
};

function indent(code) {
	lines = code.split('\n');
	for (var i = 0; i < lines.length; i++) {
		if (lines[i] !== '') {
			lines[i] = '\t' + lines[i];
		}
	}
	return lines.join('\n');
}

function Expression(node, context) {
	var left, right;
	switch (node.type) {
		case 'Add':
			left = new Expression(node.params[0], context);
			right = new Expression(node.params[1], context);
			assert(types.equal(left.type, right.type));
			this.type = left.type;
			this.compile = function() {
				return {
					'type': 'BinaryExpression',
					'operator': '+',
					'left': left.compile(),
					'right': right.compile()
				};
			};
			break;
		case 'Assign':
			left = new Expression(node.params[0], context);
			assert(left.isAssignable);

			var operator = node.params[1];
			assert.equal('=', operator,
				"Assignment operators other than '=' are not yet implemented"
			);

			right = new Expression(node.params[2], context);
			assert(types.equal(left.type, right.type));

			this.type = left.type;

			this.compile = function() {
				return {
					'type': 'AssignmentExpression',
					'operator': '=',
					'left': left.compile(),
					'right': right.compile()
				};
			};
			break;
		case 'Const':
			var numString = node.params[0];
			this.isConstant = true;
			if (numString.match(/^\d+$/)) {
				this.type = types.int;
				this.compile = function() {
					return {
						'type': 'Literal',
						'value': parseInt(numString, 10)
					};
				};
			} else {
				throw("Unsupported numeric constant: " + numString);
			}
			break;
		case 'FunctionCall':
			var callee = new Expression(node.params[0], context);
			assert.equal('function', callee.type.category);
			this.type = callee.type.returnType;
			var paramTypes = callee.type.paramTypes;

			var argNodes = node.params[1];
			assert(Array.isArray(argNodes));
			var args = [];
			for (var i = 0; i < argNodes.length; i++) {
				args[i] = new Expression(argNodes[i], context);
				assert(types.equal(paramTypes[i], args[i].type));
			}

			this.compile = function() {
				var compiledArgs = [];
				for (var i = 0; i < args.length; i++) {
					compiledArgs[i] = args[i].compile();
				}
				return {
					'type': 'CallExpression',
					'callee': callee.compile(),
					'arguments': compiledArgs
				};
			};
			break;
		case 'Var':
			var identifier = node.params[0];
			assert(identifier in context.variableTypes, "Undefined variable: " + identifier);

			this.type = context.variableTypes[identifier];
			this.isAssignable = true;
			this.compile = function() {
				return {'type': 'Identifier', 'name': identifier};
			};
			break;
		default:
			throw("Unimplemented expression type: " + node.type);
	}
}

function parameterListIsVoid(parameterList) {
	if (parameterList.length != 1) return false;
	var parameter = parameterList[0];
	if (parameter.type != 'TypeOnlyParameterDeclaration') return false;
	var parameterTypeSpecifiers = parameter.params[0];
	if (!types.equal(
		types.getTypeFromDeclarationSpecifiers(parameterTypeSpecifiers),
		types.void
	)) {
		return false;
	}

	return true;
}

function compileReturnExpression(node, context) {
	var expr = new Expression(node, context);
	assert(types.equal(expr.type, context.returnType));

	if (expr.isConstant && types.equal(expr.type, types.int)) {
		/* no type annotation necessary - just return the literal */
		return expr.compile();
	} else {
		switch (expr.type.category) {
			case 'int':
				return '(' + expr.compile() + ')|0';
			default:
				throw("Unimplemented return type: " + utils.inspect(expr.type));
		}
	}
}

function compileStatement(statement, context) {
	switch (statement.type) {
		case 'ExpressionStatement':
			var expr = new Expression(statement.params[0], context);
			return expr.compile() + ';\n';
		case 'Return':
			var returnValue = statement.params[0];
			return 'return ' + compileReturnExpression(returnValue, context) + ';\n';
		default:
			throw("Unsupported statement type: " + statement.type);
	}
}

function compileBlock(block, parentContext, returnBlockStatement) {
	var i, j;
	assert.equal('Block', block.type);

	var context = parentContext.copy();

	var declarationList = block.params[0];
	var statementList = block.params[1];

	var statementListOut = [];

	var variableDeclaratorsOut = [];

	assert(Array.isArray(declarationList));
	for (i = 0; i < declarationList.length; i++) {
		var declaration = declarationList[i];
		assert.equal('Declaration', declaration.type);
		
		var declarationSpecifiers = declaration.params[0];
		var initDeclaratorList = declaration.params[1];

		var declarationType = types.getTypeFromDeclarationSpecifiers(declarationSpecifiers);

		assert(Array.isArray(initDeclaratorList));
		for (j = 0; j < initDeclaratorList.length; j++) {
			var initDeclarator = initDeclaratorList[j];
			assert.equal('InitDeclarator', initDeclarator.type);

			var declarator = initDeclarator.params[0];
			var initialValue = initDeclarator.params[1];

			assert.equal('Identifier', declarator.type);
			var identifier = declarator.params[0];

			context.variableTypes[identifier] = declarationType;

			if (initialValue === null) {
				/* declaration does not provide an initial value */
				if (types.equal(declarationType, types.int)) {
					variableDeclaratorsOut.push({
						'type': 'VariableDeclarator',
						'id': {'type': 'Identifier', 'name': identifier},
						'init': {'type': 'Literal', 'value': 0}
					});
				} else {
					throw "Unsupported declaration type: " + util.inspect(declarationType);
				}
			} else {
				var initialValueExpr = new Expression(initialValue, context);
				assert(initialValueExpr.isConstant);
				assert(types.equal(declarationType, initialValueExpr.type));

				if (types.equal(declarationType, types.int)) {
					variableDeclaratorsOut.push({
						'type': 'VariableDeclarator',
						'id': {'type': 'Identifier', 'name': identifier},
						'init': initialValueExpr.compile()
					});
				} else {
					throw "Unsupported declaration type: " + util.inspect(declarationType);
				}
			}
		}
	}

	if (variableDeclaratorsOut.length) {
		statementListOut.push({
			'type': 'VariableDeclaration',
			'declarations': variableDeclaratorsOut,
			'kind': 'var'
		});
	}

	assert(Array.isArray(statementList));

	for (i = 0; i < statementList.length; i++) {
		compileStatement(statementList[i], context);
		// TODO: append to statementList
	}

	if (returnBlockStatement) {
		return {'type': 'BlockStatement', 'body': statementListOut};
	} else {
		return statementListOut;
	}
}

function FunctionDefinition(node) {
	assert.equal('FunctionDefinition', node.type);
	var declarationSpecifiers = node.params[0];
	var declarator = node.params[1];
	var declarationList = node.params[2];
	this.body = node.params[3];

	this.returnType = types.getTypeFromDeclarationSpecifiers(declarationSpecifiers);

	assert.equal('FunctionDeclarator', declarator.type);
	var nameDeclarator = declarator.params[0];
	var parameterList = declarator.params[1];

	assert.equal('Identifier', nameDeclarator.type);
	this.name = nameDeclarator.params[0];

	assert(Array.isArray(parameterList));
	this.parameters = [];
	var parameterTypes = [];

	if (!parameterListIsVoid(parameterList)) {
		for (var i = 0; i < parameterList.length; i++) {
			var parameterDeclaration = parameterList[i];
			assert.equal('ParameterDeclaration', parameterDeclaration.type);

			var parameterType = types.getTypeFromDeclarationSpecifiers(parameterDeclaration.params[0]);
			parameterTypes.push(parameterType);

			var parameterIdentifier = parameterDeclaration.params[1];
			assert.equal('Identifier', parameterIdentifier.type);
			var ident = parameterIdentifier.params[0];

			this.parameters.push({
				'identifier': ident,
				'type': parameterType
			});
		}
	}
	this.type = types.func(this.returnType, parameterTypes);

	assert(Array.isArray(declarationList));
	assert.equal(0, declarationList.length);
}
FunctionDefinition.prototype.compile = function(parentContext) {
	var context = parentContext.copy();
	context.returnType = this.returnType;

	var paramIdentifiers = [];
	var functionBody = [];

	for (var i = 0; i < this.parameters.length; i++) {
		var param = this.parameters[i];
		context.variableTypes[param.identifier] = param.type;
		paramIdentifiers.push({'type': 'Identifier', 'name': param.identifier});

		/* add parameter type annotation to function body */
		switch(param.type.category) {
			case 'int':
				/* x = x|0; */
				functionBody.push({
					'type': 'ExpressionStatement',
					'expression': {
						'type': 'AssignmentExpression',
						'operator': '=',
						'left': {'type': 'Identifier', 'name': param.identifier},
						'right': {
							'type': 'BinaryExpression',
							'operator': '|',
							'left': {'type': 'Identifier', 'name': param.identifier},
							'right': {'type': 'Literal', 'value': 0}
						}
					}
				});
				break;
			default:
				throw "Parameter type annotation not yet implemented: " + util.inspect(param.type);
		}
	}

	functionBody = functionBody.concat(compileBlock(this.body, context, false));

	var functionDeclaration = {
		'type': 'FunctionDeclaration',
		'id': {'type': 'Identifier', 'name': this.name},
		'params': paramIdentifiers,
		'body': {
			'type': 'BlockStatement',
			'body': functionBody
		}
	};

	return functionDeclaration;
};

function compileModule(name, ast) {
	assert(Array.isArray(ast),
		util.format('compileModule expected an array, got %s', util.inspect(ast))
	);

	var i, fd;
	var functionDefinitions = [];
	var context = new Context(null, {});

	var moduleBody = [
		{
			'type': 'ExpressionStatement',
			'expression':  {'type': 'Literal', 'value': "use asm"}
		}
	];

	for (i = 0; i < ast.length; i++) {
		switch (ast[i].type) {
			case 'FunctionDefinition':
				fd = new FunctionDefinition(ast[i]);
				functionDefinitions.push(fd);
				context.variableTypes[fd.name] = fd.type;
				break;
			default:
				throw "Unexpected node type: " + ast[i].type;
		}
	}

	for (i = 0; i < functionDefinitions.length; i++) {
		fd = functionDefinitions[i];
		moduleBody.push(fd.compile(context));
	}

	var exportsTable = [];
	for (i = 0; i < functionDefinitions.length; i++) {
		fd = functionDefinitions[i];
		exportsTable.push({
			'type': 'Property',
			'key': {'type': 'Identifier', 'name': fd.name},
			'value': {'type': 'Identifier', 'name': fd.name},
			'kind': 'init'
		});
	}

	moduleBody.push({
		'type': 'ReturnStatement',
		'argument': {
			'type': 'ObjectExpression',
			'properties': exportsTable
		}
	});

	var program = {
		'type': 'Program',
		'body': [{
			'type': 'FunctionDeclaration',
			'id': {'type': 'Identifier', 'name': name},
			'params': [],
			'body': {
				'type': 'BlockStatement',
				'body': moduleBody
			}
		}]
	};
	return program;
}

exports.compileModule = compileModule;
