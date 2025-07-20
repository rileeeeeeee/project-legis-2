document.addEventListener('DOMContentLoaded', () => {
    const pages = document.querySelectorAll('.page-content');
    const navLinks = document.querySelectorAll('.nav-link');
    
    function showPage(pageId) {
        pages.forEach(page => page.classList.toggle('active', page.id === pageId));
        navLinks.forEach(link => {
            const linkPage = link.dataset.page || (link.getAttribute('href') ? link.getAttribute('href').substring(1) : null);
            link.classList.toggle('active', linkPage === pageId);
        });
        window.scrollTo(0, 0);
        
        // Close selection analysis panel when navigating to any page
        const panel = document.getElementById('selectionAnalysisPanel');
        if (panel) panel.style.display = 'none';
    }
    
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const pageId = e.currentTarget.dataset.page || e.currentTarget.getAttribute('href').substring(1);
            showPage(pageId);
        });
    });

    const analystPage = document.getElementById('analyst');
    if (analystPage) {
        const inputText = analystPage.querySelector('#inputText');
        const clauseTypeSelect = analystPage.querySelector('#clauseType');
        const analyzeBtn = analystPage.querySelector('#analyzeBtn');
        const resultsSection = analystPage.querySelector('#resultsSection');
        const yourClauseOutput = analystPage.querySelector('#yourClauseOutput');
        const marketAnalysisOutput = analystPage.querySelector('#marketAnalysisOutput');
        const inputForm = analystPage.querySelector('#inputForm');
        const resetBtn = analystPage.querySelector('#resetBtn');
        const tooltip = document.createElement('div');
        tooltip.id = 'tooltip';
        document.body.appendChild(tooltip);

        let pollingInterval;

        function checkInputs() {
            analyzeBtn.disabled = inputText.value.trim() === '' || clauseTypeSelect.value === '';
        }

        function resetView() {
            clearInterval(pollingInterval);
            resultsSection.classList.add('hidden');
            inputForm.style.display = 'block';
            inputText.value = '';
            clauseTypeSelect.value = '';
            checkInputs();
            
            // Close selection analysis panel on reset
            const panel = document.getElementById('selectionAnalysisPanel');
            if (panel) panel.style.display = 'none';
        }

        inputText.addEventListener('input', checkInputs);
        clauseTypeSelect.addEventListener('change', checkInputs);
        analyzeBtn.addEventListener('click', startAnalysisJob);
        resetBtn.addEventListener('click', resetView);

        async function startAnalysisJob() {
            resultsSection.classList.remove('hidden');
            inputForm.style.display = 'none';
            yourClauseOutput.innerHTML = `<div class="loading-placeholder"><p class="text-gray-400 italic">Preparing interactive document...</p></div>`;
            marketAnalysisOutput.innerHTML = `<div class="loading-placeholder"><p class="text-gray-400 italic">Generating market analysis...</p><div class="progress-bar-container mt-4"><div class="progress-bar-indeterminate"></div></div></div>`;

            try {
                const response = await fetch('/api/analyze', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userClause: inputText.value, clauseType: clauseTypeSelect.value })
                });
                if (!response.ok) throw new Error((await response.json()).error);
                const { jobId } = await response.json();
                pollForResult(jobId);
            } catch (error) {
                marketAnalysisOutput.innerHTML = `<p class="text-red-400">An error occurred: ${error.message}</p>`;
                yourClauseOutput.innerHTML = '';
            }
        }

        function pollForResult(jobId) {
            let attempts = 0;
            pollingInterval = setInterval(async () => {
                attempts++;
                if (attempts > 60) {
                    clearInterval(pollingInterval);
                    marketAnalysisOutput.innerHTML = `<p class="text-red-400">Analysis timed out. Please try again.</p>`;
                    yourClauseOutput.innerHTML = '';
                    return;
                }
                try {
                    const statusResponse = await fetch(`/api/status/${jobId}`);
                    if (!statusResponse.ok) return;
                    const result = await statusResponse.json();
                    if (result.status === 'complete') {
                        clearInterval(pollingInterval);
                        renderMainAnalysis(result.data.mainAnalysis);
                    } else if (result.status === 'error') {
                        clearInterval(pollingInterval);
                        marketAnalysisOutput.innerHTML = `<p class="text-red-400">An error occurred during analysis: ${result.error}</p>`;
                        yourClauseOutput.innerHTML = '';
                    }
                } catch (e) { /* Ignore fetch errors */ }
            }, 3000);
        }

        function renderMainAnalysis(mainAnalysis) {
            if (mainAnalysis && !mainAnalysis.error) {
                marketAnalysisOutput.innerHTML = formatMarkdown(mainAnalysis.marketAnalysis || '');
                renderInteractiveClause(mainAnalysis.inlineAnnotations || []);
            } else {
                marketAnalysisOutput.innerHTML = `<p class="text-yellow-400">${mainAnalysis?.error || 'Analysis data is missing.'}</p>`;
                yourClauseOutput.innerHTML = `<p>${escapeHTML(inputText.value)}</p>`;
            }
        }

        function formatMarkdown(text) {
             if (typeof text !== 'string') return '';
            const lines = escapeHTML(text).split('\n');
            let html = '';
            let inList = false;
            lines.forEach(line => {
                line = line.trim();
                line = line.replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold text-gray-100">$1</strong>');
                if (line.startsWith('#')) {
                    if (inList) { html += '</ul>'; inList = false; }
                    const headingText = line.replace(/^#+\s*/, '');
                    html += `<h3 class="text-lg font-semibold text-indigo-300 mb-3 mt-6 border-b border-gray-700 pb-2">${headingText}</h3>`;
                    return;
                }
                if (line.startsWith('-') || line.startsWith('*')) {
                    if (!inList) { html += '<ul class="list-disc list-inside space-y-2 mb-4">'; inList = true; }
                    html += `<li class="ml-4">${line.replace(/^[\*-]\s*/, '')}</li>`;
                    return;
                }
                if (inList) { html += '</ul>'; inList = false; }
                if (line.length > 0) { html += `<p class="mb-4">${line}</p>`; }
            });
            if (inList) { html += '</ul>'; }
            return html;
        }
        
        // FIXED: Prevent partial word matching
        function renderInteractiveClause(annotations) {
            const originalText = inputText.value;
            
            // Helper function to check if character is word boundary
            function isWordBoundary(char) {
                return !(/[a-zA-Z0-9]/).test(char);
            }

            // 1. Find all occurrences with boundary checking
            const positions = [];
            annotations.forEach(ann => {
                if (!ann.phrase) return;
                
                const regex = new RegExp(escapeRegExp(ann.phrase), 'gi');
                let match;
                while ((match = regex.exec(originalText)) !== null) {
                    const start = match.index;
                    const end = start + match[0].length;
                    
                    // Check boundaries
                    const prevChar = start > 0 ? originalText[start - 1] : '';
                    const nextChar = end < originalText.length ? originalText[end] : '';
                    
                    // Only include if surrounded by word boundaries
                    if (isWordBoundary(prevChar) && isWordBoundary(nextChar)) {
                        positions.push({
                            start,
                            end,
                            explanation: ann.explanation,
                            phrase: ann.phrase,
                            matchedText: match[0]
                        });
                    }
                }
            });

            // 2. Filter and sort
            let filteredPositions = positions.filter(pos => {
                const phrase = pos.matchedText;
                return phrase.length >= 4 && 
                    !/\b(a|an|the|and|or|of|in|to|by|for)\b/i.test(phrase);
            });

            filteredPositions.sort((a, b) => {
                if (a.start !== b.start) return a.start - b.start;
                return (b.end - b.start) - (a.end - a.start);
            });

            // 3. Build HTML with non-overlapping highlights
            let lastEnd = 0;
            let htmlFragments = [];
            
            for (const pos of filteredPositions) {
                // Skip positions inside previous highlights
                if (pos.start < lastEnd) continue;
                
                // Add text before this highlight
                if (pos.start > lastEnd) {
                    const before = originalText.substring(lastEnd, pos.start);
                    htmlFragments.push(escapeHTML(before));
                }
                
                // Add the highlighted portion
                htmlFragments.push(
                    `<span class="highlight" data-explanation="${escapeHTML(pos.explanation)}">${escapeHTML(pos.matchedText)}</span>`
                );
                
                lastEnd = pos.end;
            }
            
            // Add remaining text
            if (lastEnd < originalText.length) {
                const after = originalText.substring(lastEnd);
                htmlFragments.push(escapeHTML(after));
            }

            // 4. Set final HTML with proper line breaks
            yourClauseOutput.innerHTML = htmlFragments.join('').replace(/\n/g, '<br>');
        }
        
        // Enhanced selection analysis UI
        const selectionAnalysisBtn = document.createElement('button');
        selectionAnalysisBtn.id = 'selectionAnalysisBtn';
        selectionAnalysisBtn.textContent = 'Analyze Selection';
        selectionAnalysisBtn.className = 'hidden fixed bg-indigo-600 text-white px-4 py-2 rounded-lg shadow-lg z-50 font-medium';
        document.body.appendChild(selectionAnalysisBtn);

        const selectionAnalysisPanel = document.createElement('div');
        selectionAnalysisPanel.id = 'selectionAnalysisPanel';
        selectionAnalysisPanel.className = 'fixed right-0 top-0 h-full w-full md:w-1/3 bg-gray-900 p-0 overflow-hidden shadow-xl z-40 hidden flex flex-col';
        selectionAnalysisPanel.innerHTML = `
            <div class="bg-indigo-900 py-3 px-4 flex justify-between items-center">
                <h3 class="text-lg font-bold text-white">Selected Text Analysis</h3>
                <button id="closePanel" class="text-white hover:text-indigo-200 text-xl font-bold">×</button>
            </div>
            <div id="selectionAnalysisContent" class="p-4 overflow-auto flex-grow"></div>
        `;
        document.body.appendChild(selectionAnalysisPanel);

        // Close panel handler
        document.getElementById('closePanel').addEventListener('click', () => {
            selectionAnalysisPanel.style.display = 'none';
        });
        
        // Close panel when clicking outside of it
        document.addEventListener('click', (e) => {
            const panel = document.getElementById('selectionAnalysisPanel');
            if (panel && panel.style.display === 'flex' && 
                !panel.contains(e.target) && 
                e.target !== selectionAnalysisBtn) {
                panel.style.display = 'none';
            }
        });

        // Text selection handler - FIXED: Only show button for document content
        yourClauseOutput.addEventListener('mouseup', (e) => {
            // Only show button if we're in results view
            if (resultsSection.classList.contains('hidden')) return;
            
            const selection = window.getSelection();
            const selectedText = selection.toString().trim();
            
            // Only proceed if we have valid selection in the clause output
            if (selectedText.length > 3) {
                const range = selection.getRangeAt(0);
                const rect = range.getBoundingClientRect();
                selectionAnalysisBtn.style.display = 'block';
                selectionAnalysisBtn.style.top = `${rect.bottom + window.scrollY + 5}px`;
                selectionAnalysisBtn.style.left = `${rect.left + window.scrollX}px`;
                selectionAnalysisBtn.dataset.selection = selectedText;
            } else {
                selectionAnalysisBtn.style.display = 'none';
            }
        });

        // Hide button when clicking elsewhere - FIXED: Don't hide when clicking button
        document.addEventListener('mousedown', (e) => {
            if (e.target !== selectionAnalysisBtn && !yourClauseOutput.contains(e.target)) {
                selectionAnalysisBtn.style.display = 'none';
            }
        });

        // Selection analysis handler - FIXED: Proper event handling
        selectionAnalysisBtn.addEventListener('click', async (e) => {
            const selectedText = selectionAnalysisBtn.dataset.selection;
            if (!selectedText) return;
            
            // Don't hide the button here - we'll hide it after processing
            selectionAnalysisPanel.style.display = 'flex';
            
            const contentDiv = document.getElementById('selectionAnalysisContent');
            contentDiv.innerHTML = `
                <div class="py-4">
                    <div class="flex items-center justify-center mb-4">
                        <div class="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-indigo-500"></div>
                    </div>
                    <p class="text-center text-gray-400">Analyzing selected text...</p>
                </div>
            `;
            
            try {
                const response = await fetch('/api/analyze-selection', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        selectedText,
                        fullText: inputText.value,
                        clauseType: clauseTypeSelect.value
                    })
                });
                
                if (!response.ok) throw new Error(await response.text());
                const analysis = await response.json();
                
                contentDiv.innerHTML = `
                    <div class="mb-4 p-3 bg-gray-800 rounded-lg border border-gray-700">
                        <p class="font-mono text-sm text-gray-300">"${escapeHTML(selectedText)}"</p>
                    </div>
                    <div class="analysis-content text-gray-300">${formatMarkdown(analysis.explanation)}</div>
                `;
            } catch (error) {
                contentDiv.innerHTML = `
                    <div class="p-4 text-red-400">
                        <h3 class="text-lg font-semibold mb-2">Analysis Error</h3>
                        <p>${error.message}</p>
                    </div>
                `;
            }
            
            // Hide the button after opening the panel
            selectionAnalysisBtn.style.display = 'none';
        });
        
        document.addEventListener('mouseover', e => {
            if (e.target.classList.contains('highlight')) {
                tooltip.textContent = e.target.dataset.explanation;
                tooltip.style.display = 'block';
            }
        });
        document.addEventListener('mouseout', e => {
            if (e.target.classList.contains('highlight')) {
                tooltip.style.display = 'none';
            }
        });
        document.addEventListener('mousemove', e => {
            if (tooltip.style.display === 'block') {
                tooltip.style.left = e.pageX + 15 + 'px';
                tooltip.style.top = e.pageY + 15 + 'px';
            }
        });

        function escapeRegExp(string) { 
            return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); 
        }
        function escapeHTML(str) {
            if (typeof str !== 'string') return '';
            const div = document.createElement('div');
            div.appendChild(document.createTextNode(str));
            return div.innerHTML;
        }
    }

    const useCasesPage = document.getElementById('use-cases');
    if (useCasesPage) {
        useCasesPage.querySelectorAll('.use-case-btn').forEach(button => {
            button.addEventListener('click', () => {
                const text = button.nextElementSibling.value;
                const analystInput = document.getElementById('inputText');
                const clauseTypeSelect = document.getElementById('clauseType');
                if (analystInput) {
                    analystInput.value = text;
                    const buttonText = button.textContent.toLowerCase();
                    if (buttonText.includes('indemnification')) clauseTypeSelect.value = 'indemnification';
                    else if (buttonText.includes('confidentiality')) clauseTypeSelect.value = 'confidentiality';
                    else if (buttonText.includes('liability')) clauseTypeSelect.value = 'limitation_of_liability';
                    
                    document.getElementById('analyzeBtn').disabled = false;
                    document.getElementById('resultsSection').classList.add('hidden');
                    document.getElementById('inputForm').style.display = 'block';
                }
                showPage('analyst');
            });
        });
    }

    showPage('home');
});
