import * as vscode from "vscode"
import * as path from "path"
import deepEqual from "fast-deep-equal"

export function getNewDiagnostics(
	oldDiagnostics: [vscode.Uri, vscode.Diagnostic[]][],
	newDiagnostics: [vscode.Uri, vscode.Diagnostic[]][],
): [vscode.Uri, vscode.Diagnostic[]][] {
	const newProblems: [vscode.Uri, vscode.Diagnostic[]][] = []
	const oldMap = new Map(oldDiagnostics)

	for (const [uri, newDiags] of newDiagnostics) {
		const oldDiags = oldMap.get(uri) || []
		const newProblemsForUri = newDiags.filter((newDiag) => !oldDiags.some((oldDiag) => deepEqual(oldDiag, newDiag)))

		if (newProblemsForUri.length > 0) {
			newProblems.push([uri, newProblemsForUri])
		}
	}

	return newProblems
}

// Usage:
// const oldDiagnostics = // ... your old diagnostics array
// const newDiagnostics = // ... your new diagnostics array
// const newProblems = getNewDiagnostics(oldDiagnostics, newDiagnostics);

// Example usage with mocks:
//
// // Mock old diagnostics
// const oldDiagnostics: [vscode.Uri, vscode.Diagnostic[]][] = [
//     [vscode.Uri.file("/path/to/file1.ts"), [
//         new vscode.Diagnostic(new vscode.Range(0, 0, 0, 10), "Old error in file1", vscode.DiagnosticSeverity.Error)
//     ]],
//     [vscode.Uri.file("/path/to/file2.ts"), [
//         new vscode.Diagnostic(new vscode.Range(5, 5, 5, 15), "Old warning in file2", vscode.DiagnosticSeverity.Warning)
//     ]]
// ];
//
// // Mock new diagnostics
// const newDiagnostics: [vscode.Uri, vscode.Diagnostic[]][] = [
//     [vscode.Uri.file("/path/to/file1.ts"), [
//         new vscode.Diagnostic(new vscode.Range(0, 0, 0, 10), "Old error in file1", vscode.DiagnosticSeverity.Error),
//         new vscode.Diagnostic(new vscode.Range(2, 2, 2, 12), "New error in file1", vscode.DiagnosticSeverity.Error)
//     ]],
//     [vscode.Uri.file("/path/to/file2.ts"), [
//         new vscode.Diagnostic(new vscode.Range(5, 5, 5, 15), "Old warning in file2", vscode.DiagnosticSeverity.Warning)
//     ]],
//     [vscode.Uri.file("/path/to/file3.ts"), [
//         new vscode.Diagnostic(new vscode.Range(1, 1, 1, 11), "New error in file3", vscode.DiagnosticSeverity.Error)
//     ]]
// ];
//
// const newProblems = getNewProblems(oldDiagnostics, newDiagnostics);
//
// console.log("New problems:");
// for (const [uri, diagnostics] of newProblems) {
//     console.log(`File: ${uri.fsPath}`);
//     for (const diagnostic of diagnostics) {
//         console.log(`- ${diagnostic.message} (${diagnostic.range.start.line}:${diagnostic.range.start.character})`);
//     }
// }
//
// // Expected output:
// // New problems:
// // File: /path/to/file1.ts
// // - New error in file1 (2:2)
// // File: /path/to/file3.ts
// // - New error in file3 (1:1)

// will return empty string if no problems with the given severity are found
export async function diagnosticsToProblemsString(
	diagnostics: [vscode.Uri, vscode.Diagnostic[]][],
	severities: vscode.DiagnosticSeverity[],
	cwd: string,
	includeDiagnosticMessages: boolean = true,
	maxDiagnosticMessages?: number,
): Promise<string> {
	// If diagnostics are disabled, return empty string
	if (!includeDiagnosticMessages) {
		return ""
	}

	const documents = new Map<vscode.Uri, vscode.TextDocument>()
	const fileStats = new Map<vscode.Uri, vscode.FileStat>()
	let result = ""

	// If we have a limit, use count-based limiting
	if (maxDiagnosticMessages && maxDiagnosticMessages > 0) {
		let includedCount = 0
		let totalCount = 0

		// Flatten all diagnostics with their URIs
		const allDiagnostics: { uri: vscode.Uri; diagnostic: vscode.Diagnostic; formattedText?: string }[] = []
		for (const [uri, fileDiagnostics] of diagnostics) {
			const filtered = fileDiagnostics.filter((d) => severities.includes(d.severity))
			for (const diagnostic of filtered) {
				allDiagnostics.push({ uri, diagnostic })
				totalCount++
			}
		}

		// Sort by severity (errors first) and then by line number
		allDiagnostics.sort((a, b) => {
			const severityDiff = a.diagnostic.severity - b.diagnostic.severity
			if (severityDiff !== 0) return severityDiff
			return a.diagnostic.range.start.line - b.diagnostic.range.start.line
		})

		// Process diagnostics up to the count limit
		const includedDiagnostics: typeof allDiagnostics = []
		for (const item of allDiagnostics) {
			// Stop if we've reached the count limit
			if (includedCount >= maxDiagnosticMessages) {
				break
			}

			// Format the diagnostic
			let label: string
			switch (item.diagnostic.severity) {
				case vscode.DiagnosticSeverity.Error:
					label = "Error"
					break
				case vscode.DiagnosticSeverity.Warning:
					label = "Warning"
					break
				case vscode.DiagnosticSeverity.Information:
					label = "Information"
					break
				case vscode.DiagnosticSeverity.Hint:
					label = "Hint"
					break
				default:
					label = "Diagnostic"
			}
			const line = item.diagnostic.range.start.line + 1
			const source = item.diagnostic.source ? `${item.diagnostic.source} ` : ""

			// Pre-format the diagnostic text
			let diagnosticText = ""
			try {
				let fileStat = fileStats.get(item.uri)
				if (!fileStat) {
					fileStat = await vscode.workspace.fs.stat(item.uri)
					fileStats.set(item.uri, fileStat)
				}
				if (fileStat.type === vscode.FileType.File) {
					const document = documents.get(item.uri) || (await vscode.workspace.openTextDocument(item.uri))
					documents.set(item.uri, document)
					const lineContent = document.lineAt(item.diagnostic.range.start.line).text
					diagnosticText = `\n- [${source}${label}] ${line} | ${lineContent} : ${item.diagnostic.message}`
				} else {
					diagnosticText = `\n- [${source}${label}] 1 | (directory) : ${item.diagnostic.message}`
				}
			} catch {
				diagnosticText = `\n- [${source}${label}] ${line} | (unavailable) : ${item.diagnostic.message}`
			}

			item.formattedText = diagnosticText
			includedDiagnostics.push(item)
			includedCount++
		}

		// Group included diagnostics by URI for output
		const groupedDiagnostics = new Map<string, { uri: vscode.Uri; diagnostics: typeof allDiagnostics }>()
		for (const item of includedDiagnostics) {
			const key = item.uri.toString()
			if (!groupedDiagnostics.has(key)) {
				groupedDiagnostics.set(key, { uri: item.uri, diagnostics: [] })
			}
			groupedDiagnostics.get(key)!.diagnostics.push(item)
		}

		// Build the output
		for (const { uri, diagnostics: fileDiagnostics } of groupedDiagnostics.values()) {
			const sortedDiagnostics = fileDiagnostics.sort(
				(a, b) => a.diagnostic.range.start.line - b.diagnostic.range.start.line,
			)
			if (sortedDiagnostics.length > 0) {
				result += `\n\n${path.relative(cwd, uri.fsPath).toPosix()}`
				for (const item of sortedDiagnostics) {
					result += item.formattedText
				}
			}
		}

		// Add a note if we hit the limit
		if (totalCount > includedCount) {
			result += `\n\n... ${totalCount - includedCount} more problems omitted to prevent context overflow`
		}
	} else {
		// No limit, process all diagnostics as before
		for (const [uri, fileDiagnostics] of diagnostics) {
			const problems = fileDiagnostics
				.filter((d) => severities.includes(d.severity))
				.sort((a, b) => a.range.start.line - b.range.start.line)
			if (problems.length > 0) {
				result += `\n\n${path.relative(cwd, uri.fsPath).toPosix()}`
				for (const diagnostic of problems) {
					let label: string
					switch (diagnostic.severity) {
						case vscode.DiagnosticSeverity.Error:
							label = "Error"
							break
						case vscode.DiagnosticSeverity.Warning:
							label = "Warning"
							break
						case vscode.DiagnosticSeverity.Information:
							label = "Information"
							break
						case vscode.DiagnosticSeverity.Hint:
							label = "Hint"
							break
						default:
							label = "Diagnostic"
					}
					const line = diagnostic.range.start.line + 1 // VSCode lines are 0-indexed
					const source = diagnostic.source ? `${diagnostic.source} ` : ""
					try {
						let fileStat = fileStats.get(uri)
						if (!fileStat) {
							fileStat = await vscode.workspace.fs.stat(uri)
							fileStats.set(uri, fileStat)
						}
						if (fileStat.type === vscode.FileType.File) {
							const document = documents.get(uri) || (await vscode.workspace.openTextDocument(uri))
							documents.set(uri, document)
							const lineContent = document.lineAt(diagnostic.range.start.line).text
							result += `\n- [${source}${label}] ${line} | ${lineContent} : ${diagnostic.message}`
						} else {
							result += `\n- [${source}${label}] 1 | (directory) : ${diagnostic.message}`
						}
					} catch {
						result += `\n- [${source}${label}] ${line} | (unavailable) : ${diagnostic.message}`
					}
				}
			}
		}
	}

	return result.trim()
}
