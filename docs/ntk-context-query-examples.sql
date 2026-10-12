-- Executed against NTK-context-query-demo.sqlite (1806.07572v4.pdf, 19 pages).
-- This database contains this one PDF only. Page numbers are 1-based PDF pages.
-- pages(page_no, raw_text): original extraction; page_fts(page_no, text): normalized FTS5 index.
-- Read-only demo setting; this alone is NOT a sandbox for arbitrary model SQL.
PRAGMA query_only = ON;

-- A1: Locate Theorem 2
SELECT page_no,
       snippet(page_fts, 1, '[', ']', ' … ', 28) AS excerpt
FROM page_fts
WHERE page_fts MATCH '"Theorem 2"'
ORDER BY bm25(page_fts), CAST(page_no AS INTEGER)
LIMIT 5;

-- A2: Find smoothness assumptions
SELECT page_no,
       snippet(page_fts, 1, '[', ']', ' … ', 28) AS excerpt
FROM page_fts
WHERE page_fts MATCH 'Lipschitz AND "second derivative"'
ORDER BY bm25(page_fts), CAST(page_no AS INTEGER)
LIMIT 5;

-- A3: Check the activation used in experiments
SELECT page_no,
       snippet(page_fts, 1, '[', ']', ' … ', 28) AS excerpt
FROM page_fts
WHERE page_fts MATCH 'ReLU'
ORDER BY bm25(page_fts), CAST(page_no AS INTEGER)
LIMIT 5;

-- A4: Check the meaning of the width limit
SELECT page_no,
       snippet(page_fts, 1, '[', ']', ' … ', 28) AS excerpt
FROM page_fts
WHERE page_fts MATCH 'sequentially'
ORDER BY bm25(page_fts), CAST(page_no AS INTEGER)
LIMIT 5;

-- B1: Find the early stopping argument
SELECT page_no,
       snippet(page_fts, 1, '[', ']', ' … ', 28) AS excerpt
FROM page_fts
WHERE page_fts MATCH '"early stopping"'
ORDER BY bm25(page_fts), CAST(page_no AS INTEGER)
LIMIT 5;

-- B2: Find its eigenvalue explanation
SELECT page_no,
       snippet(page_fts, 1, '[', ']', ' … ', 28) AS excerpt
FROM page_fts
WHERE page_fts MATCH 'eigenvalues AND eigenspaces'
ORDER BY bm25(page_fts), CAST(page_no AS INTEGER)
LIMIT 5;

-- C1: Locate positive-definiteness conditions and proof
SELECT page_no,
       snippet(page_fts, 1, '[', ']', ' … ', 28) AS excerpt
FROM page_fts
WHERE page_fts MATCH '"Proposition 2"'
ORDER BY bm25(page_fts), CAST(page_no AS INTEGER)
LIMIT 5;

-- C2: Follow proof dependencies
SELECT page_no,
       snippet(page_fts, 1, '[', ']', ' … ', 28) AS excerpt
FROM page_fts
WHERE page_fts MATCH '"Theorem 3" OR "Lemma 2"'
ORDER BY bm25(page_fts), CAST(page_no AS INTEGER)
LIMIT 5;

-- D1: Demonstrate an unhelpful cross-language literal query
SELECT page_no,
       snippet(page_fts, 1, '[', ']', ' … ', 28) AS excerpt
FROM page_fts
WHERE page_fts MATCH '무한 너비'
ORDER BY bm25(page_fts), CAST(page_no AS INTEGER)
LIMIT 5;

-- D2: Demonstrate zero matches do not establish absence
SELECT page_no,
       snippet(page_fts, 1, '[', ']', ' … ', 28) AS excerpt
FROM page_fts
WHERE page_fts MATCH '"minimum width" OR "minimal width"'
ORDER BY bm25(page_fts), CAST(page_no AS INTEGER)
LIMIT 5;

-- A: Read actual source after search; include the paragraph before/after the match.
SELECT page_no, raw_text FROM pages WHERE page_no IN (6,7,11,13) ORDER BY page_no;

-- B: Read the least-squares setup and the continuation on the following page.
SELECT page_no, raw_text FROM pages WHERE page_no BETWEEN 6 AND 7 ORDER BY page_no;

-- C: Read the proposition and its appendix proof, in document order.
SELECT page_no, raw_text FROM pages WHERE page_no IN (6,17,18,19) ORDER BY page_no;
