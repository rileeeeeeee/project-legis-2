import express from 'express';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { standards } from './market_standards.js';
import { specialists } from './specialist_prompts.js';
import legalDictionary from './legal_dictionary.js';
import path from 'path';
import { fileURLToPath } from 'url';

// Get directory name for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

const jobs = {};

const cleanAndParseJson = (rawText) => {
    try {
        return JSON.parse(rawText);
    } catch (e) {
        throw new Error(`Failed to parse guaranteed JSON from AI. Original error: ${e.message}. AI response: ${rawText}`);
    }
};

// Helper: normalize phrase for deduplication
const normalizePhrase = (phrase) => {
    return phrase
        .trim()
        .toLowerCase()
        .replace(/[^\w\s]/g, '') // Remove punctuation
        .replace(/\s+/g, ' ');   // Normalize whitespace
};

const postProcessAnnotations = (headingAnns, substantiveAnns, specialistAnns, originalText) => {
    // Combine all annotations
    const allAnnotations = [
        ...(headingAnns || []),
        ...(substantiveAnns || []),
        ...(specialistAnns || [])
    ];
    
    // Add dictionary-based annotations
    const dictionaryAnnotations = [];
    for (const term in legalDictionary) {
        if (originalText.toLowerCase().includes(term.toLowerCase())) {
            dictionaryAnnotations.push({
                phrase: term,
                explanation: legalDictionary[term]
            });
        }
    }
    
    const uniqueAnnotations = [];
    const seenPhrases = new Set();

    for (const annotation of [...allAnnotations, ...dictionaryAnnotations]) {
        const phrase = annotation?.phrase?.trim();
        if (phrase) {
            const normalized = normalizePhrase(phrase);
            // Minimum length of 4 characters and not already seen
            if (normalized.length >= 4 && !seenPhrases.has(normalized)) {
                uniqueAnnotations.push(annotation);
                seenPhrases.add(normalized);
            }
        }
    }
    return uniqueAnnotations;
};

app.use(express.json());

// Serve static files from the 'public' directory with proper MIME types
app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript');
        } else if (filePath.endsWith('.css')) {
            res.setHeader('Content-Type', 'text/css');
        }
    }
}));

app.post('/api/analyze', (req, res) => {
    const { userClause, clauseType } = req.body;
    if (!userClause || !clauseType) return res.status(400).json({ error: 'Clause and type required.' });

    const jobId = crypto.randomUUID();
    jobs[jobId] = { status: 'pending' };
    res.status(202).json({ jobId });

    (async () => {
        try {
            // ## REVISED SUMMARY AGENT PROMPT ##
            const summaryPrompt = `As a legal analysis engine, analyze the provided legal text from a strategic perspective. Consider:
1. The primary clause type: ${standards[clauseType]?.name || clauseType}
2. Market standards for similar clauses
3. Potential risks for the client
4. Negotiation leverage points

Provide a concise report in markdown format with these sections:
## Key Strengths
## Potential Weaknesses
## Overall Fairness Assessment
## Strategic Recommendations

Be direct and actionable. Do not include any introductory or closing remarks like "To: Client" or "From: ...". Start directly with the first section heading.

---DOCUMENT---
${userClause}`;
            const summaryPromise = fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ role: "user", parts: [{ text: summaryPrompt }] }]
                })
            });

            // --- ENHANCED HEADING ANALYSIS AGENT ---
            const headingPrompt = `You are a legal document parser. Identify EVERY section heading in the document below, including:
- Numbered headings (e.g., "1. Scope", "2. Limitation")
- Unnumbered headings
- Subheadings
- Section titles in ALL CAPS
- Headers with Roman numerals
- Titles following "ARTICLE" or "SECTION"

For EACH heading:
1. Extract the EXACT heading text including any numbering
2. Provide a concise explanation of its legal significance

Return ONLY a JSON object with "annotations" array containing objects with "phrase" and "explanation" keys.

---DOCUMENT---
${userClause}`;
            const headingPromise = fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ role: "user", parts: [{ text: headingPrompt }] }],
                    generationConfig: { response_mime_type: "application/json" }
                })
            });

            // --- ENHANCED SUBSTANTIVE ANALYSIS AGENT ---
            const substantivePrompt = `You are a legal analyst. Identify and explain ALL legally significant phrases in the document body including:
- Terms of art (e.g., "force majeure", "joint and several liability")
- Critical obligations (e.g., "shall indemnify", "covenant not to sue")
- Limitations of rights (e.g., "irrevocable license", "perpetual right")
- Liability terms (e.g., "consequential damages", "liquidated damages")
- Temporal phrases (e.g., "survive termination", "in perpetuity")
- Key modifiers (e.g., "sole discretion", "material adverse effect")
- Scope definitions (e.g., "including but not limited to")
- Notice provisions (e.g., "deemed received upon transmission")
- Governing law clauses
- Any phrase defining rights, obligations, or limitations
- Standard legal boilerplate with legal significance

Return ONLY a JSON object with "annotations" array containing objects with "phrase" (exact text) and "explanation" keys.

---DOCUMENT---
${userClause}`;
            const substantivePromise = fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ role: "user", parts: [{ text: substantivePrompt }] }],
                    generationConfig: { response_mime_type: "application/json" }
                })
            });

            // --- AGENT 4: SPECIALIST AGENTS (Parallel) ---
            let specialistAnnotations = [];
            try {
                const specialistEntries = Object.entries(specialists);
                const specialistResults = await Promise.all(
                    specialistEntries.map(async ([key, specialist]) => {
                        const prompt = `${specialist.prompt}\n\n---DOCUMENT---\n${userClause}`;
                        try {
                            const response = await fetch(API_URL, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    contents: [{ role: "user", parts: [{ text: prompt }] }],
                                    generationConfig: { response_mime_type: "application/json" }
                                })
                            });
                            return { response, specialist, error: null };
                        } catch (e) {
                            return { response: null, specialist, error: e };
                        }
                    })
                );

                for (const { response, specialist, error } of specialistResults) {
                    if (error) {
                        console.error(`Specialist ${specialist.name} failed:`, error);
                        continue;
                    }
                    if (response && response.ok) {
                        const result = await response.json();
                        try {
                            const data = cleanAndParseJson(result.candidates[0].content.parts[0].text);
                            if (data.is_problematic && data.problematic_phrase) {
                                specialistAnnotations.push({
                                    phrase: data.problematic_phrase,
                                    explanation: `${specialist.name}: ${data.reason}`
                                });
                            }
                        } catch (parseError) {
                            console.error(`Failed to parse response from ${specialist.name}:`, parseError);
                        }
                    } else if (response) {
                        console.error(`Specialist ${specialist.name} returned error: ${response.status}`);
                    }
                }
            } catch (e) {
                console.error('Specialist analysis failed:', e);
            }

            // --- RUN MAIN AGENTS IN PARALLEL ---
            const [summaryResponse, headingResponse, substantiveResponse] = await Promise.all([
                summaryPromise,
                headingPromise,
                substantivePromise
            ]);

            if (!summaryResponse.ok) throw new Error(`Summary Agent failed: ${summaryResponse.statusText}`);
            if (!headingResponse.ok) throw new Error(`Heading Agent failed: ${headingResponse.statusText}`);
            if (!substantiveResponse.ok) throw new Error(`Substantive Agent failed: ${substantiveResponse.statusText}`);

            // --- PROCESS RESULTS ---
            const summaryResult = await summaryResponse.json();
            const marketAnalysis = summaryResult.candidates[0].content.parts[0].text;

            const headingResult = await headingResponse.json();
            const headingAnnotations = cleanAndParseJson(headingResult.candidates[0].content.parts[0].text)?.annotations || [];

            const substantiveResult = await substantiveResponse.json();
            const substantiveAnnotations = cleanAndParseJson(substantiveResult.candidates[0].content.parts[0].text)?.annotations || [];
            
            // --- COMBINE & FINALIZE ---
            const finalAnnotations = postProcessAnnotations(
                headingAnnotations,
                substantiveAnnotations,
                specialistAnnotations,
                userClause
            );
            
            jobs[jobId] = {
                status: 'complete',
                data: {
                    mainAnalysis: {
                        marketAnalysis,
                        inlineAnnotations: finalAnnotations
                    }
                }
            };

        } catch (error) {
            console.error(`Job ${jobId} failed:`, error);
            jobs[jobId] = { status: 'error', error: `Analysis failed: ${error.message}` };
        }
    })();
});

// Selection analysis endpoint
app.post('/api/analyze-selection', async (req, res) => {
    const { selectedText, fullText, clauseType } = req.body;
    if (!selectedText) return res.status(400).json({ error: 'No text selected' });

    try {
        const prompt = `As a legal expert, analyze the significance of the selected text in the context of the full document and clause type (${
            standards[clauseType]?.name || clauseType
        }).

Selected Text: """
${selectedText}
"""

Full Document Context: """
${fullText}
"""

Provide analysis covering:
1. Legal meaning and implications
2. How it compares to market standards
3. Potential risks or advantages
4. Strategic recommendations
5. Any ambiguous or problematic language

Use markdown formatting with clear headings.`;
        
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ role: "user", parts: [{ text: prompt }] }]
            })
        });
        
        if (!response.ok) throw new Error('AI analysis failed');
        const result = await response.json();
        const explanation = result.candidates[0].content.parts[0].text;
        res.json({ explanation });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/status/:jobId', (req, res) => {
    const { jobId } = req.params;
    const job = jobs[jobId];
    if (!job) return res.status(404).json({ status: 'error', error: 'Job not found.' });
    res.json(job);
    if (job.status === 'complete' || job.status === 'error') {
        delete jobs[jobId];
    }
});

// Handle SPA routing by sending index.html for all routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => console.log(`Server is running on http://localhost:${PORT}`));
