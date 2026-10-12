/** RFC 4180 CSV/TSV parser with delimiter sniffing and header detection. */

export interface Table {
	delimiter: string;
	header: string[] | null;
	rows: string[][];
	/** Rows (after the header) whose column count differs from the header's. */
	ragged: number;
}

/** Most frequent of `, ; \t |` in the first lines (outside quotes), `,` when none. */
export function sniffDelimiter(text: string, hint?: string): string {
	if (hint) return hint;
	const sample = text.slice(0, 8192).split("\n").slice(0, 10);
	let best = ",";
	let bestScore = 0;
	for (const d of [",", ";", "\t", "|"]) {
		const counts = sample.map((l) => countOutsideQuotes(l, d)).filter((c) => c > 0);
		if (!counts.length) continue;
		const score = counts.length * 10 - (Math.max(...counts) - Math.min(...counts));
		if (score > bestScore) [best, bestScore] = [d, score];
	}
	return best;
}

function countOutsideQuotes(line: string, d: string): number {
	let q = false;
	let n = 0;
	for (const c of line) {
		if (c === '"') q = !q;
		else if (c === d && !q) n++;
	}
	return n;
}

/** Parse into rows; quoted fields may contain delimiters, `""` and newlines. */
export function parseCsv(text: string, delimiter: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = "";
	let quoted = false;
	let any = false;
	const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
	for (let i = 0; i < src.length; i++) {
		const c = src[i];
		if (quoted) {
			if (c === '"') {
				if (src[i + 1] === '"') {
					field += '"';
					i++;
				} else quoted = false;
			} else field += c;
			continue;
		}
		if (c === '"' && field === "") {
			quoted = true;
			any = true;
		} else if (c === delimiter) {
			row.push(field);
			field = "";
			any = true;
		} else if (c === "\n" || c === "\r") {
			if (c === "\r" && src[i + 1] === "\n") i++;
			if (any || field) {
				row.push(field);
				rows.push(row);
			}
			row = [];
			field = "";
			any = false;
		} else {
			field += c;
			any = true;
		}
	}
	if (any || field) {
		row.push(field);
		rows.push(row);
	}
	return rows;
}

/** First row is a header when none of its cells is numeric/empty while some later row has numbers there, or all cells are unique non-numeric text. */
export function detectHeader(rows: string[][]): boolean {
	if (rows.length < 2) return false;
	const first = rows[0];
	if (first.some((c) => c.trim() === "")) return false;
	const num = (c: string) => c.trim() !== "" && !Number.isNaN(Number(c.replace(/[$€£R%\s,]/g, "")));
	if (first.every((c) => !num(c))) {
		const body = rows.slice(1, 20);
		return new Set(first).size === first.length || body.some((r) => r.some(num));
	}
	return false;
}

export function readTable(text: string, hint?: string): Table {
	const delimiter = sniffDelimiter(text, hint);
	const all = parseCsv(text, delimiter);
	const hasHeader = detectHeader(all);
	const header = hasHeader ? all[0] : null;
	const rows = hasHeader ? all.slice(1) : all;
	const width = header?.length ?? Math.max(0, ...rows.slice(0, 50).map((r) => r.length));
	return { delimiter, header, rows, ragged: rows.filter((r) => r.length !== width).length };
}

/** Compare two cells as numbers when both are numeric, else locale-aware text. */
export function compareCells(a: string, b: string): number {
	const na = Number(a);
	const nb = Number(b);
	if (a.trim() !== "" && b.trim() !== "" && !Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
	return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}
