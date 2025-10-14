/**
 * Safe DOM Rendering Utility
 *
 * Prevents XSS (Cross-Site Scripting) attacks by safely rendering user-provided data
 * into HTML elements using textContent and createElement instead of innerHTML.
 *
 * Key Security Features:
 * - Automatically escapes HTML characters (special characters like &, <, >, " are displayed as text)
 * - Prevents script execution from malicious input
 * - Supports legitimate special characters in organization names
 *
 * @example
 * // BEFORE (Vulnerable):
 * element.innerHTML = `<td>${org.organizationName}</td>`;
 *
 * // AFTER (Secure):
 * const cell = safeCreateElement('td', org.organizationName);
 * element.appendChild(cell);
 *
 * @module safe-render
 * @version 1.0.0
 * @date 2025-10-14
 */

/**
 * Safely create an HTML element with text content
 *
 * @param {string} tagName - HTML tag name (e.g., 'div', 'td', 'span')
 * @param {string|number|null} textContent - Text to display (will be escaped automatically)
 * @param {Object} options - Optional configuration
 * @param {string} options.className - CSS class name(s) to add
 * @param {Object} options.attributes - HTML attributes to set (e.g., {title: 'tooltip'})
 * @param {Object} options.style - Inline styles to apply
 * @returns {HTMLElement} - Safely created element
 *
 * @example
 * // Simple text element
 * const div = safeCreateElement('div', 'Hello World');
 *
 * // With CSS class
 * const span = safeCreateElement('span', 'Active', { className: 'status-badge' });
 *
 * // With attributes
 * const td = safeCreateElement('td', 'Data', { attributes: { title: 'Tooltip' } });
 *
 * // Special characters are displayed correctly
 * const cell = safeCreateElement('td', 'Smith & Sons "Ltd"');
 * // Displays: Smith & Sons "Ltd" (not escaped HTML entities)
 *
 * // Malicious code is neutralized
 * const bad = safeCreateElement('td', '<script>alert("XSS")</script>');
 * // Displays: <script>alert("XSS")</script> (as text, doesn't execute)
 */
function safeCreateElement(tagName, textContent, options = {}) {
    const element = document.createElement(tagName);

    // Set text content (automatically escapes HTML)
    if (textContent !== null && textContent !== undefined) {
        element.textContent = String(textContent);
    }

    // Add CSS class if provided
    if (options.className) {
        element.className = options.className;
    }

    // Set attributes if provided
    if (options.attributes) {
        Object.keys(options.attributes).forEach(attr => {
            element.setAttribute(attr, options.attributes[attr]);
        });
    }

    // Apply inline styles if provided
    if (options.style) {
        Object.assign(element.style, options.style);
    }

    return element;
}

/**
 * Safely create a table row with multiple cells
 *
 * @param {Array<string|Object>} cells - Array of cell data (strings or config objects)
 * @param {Object} options - Optional row configuration
 * @param {string} options.className - CSS class for the row
 * @param {Function} options.onClick - Click handler for the row
 * @returns {HTMLTableRowElement} - Safely created table row
 *
 * @example
 * // Simple row with text cells
 * const row = safeCreateTableRow(['Cell 1', 'Cell 2', 'Cell 3']);
 *
 * // Row with styled cells
 * const row = safeCreateTableRow([
 *   { text: 'ID-123', className: 'id-cell' },
 *   { text: 'Active', className: 'status-badge success' },
 *   { text: 'Smith & Sons' }
 * ]);
 *
 * // Row with click handler
 * const row = safeCreateTableRow(
 *   ['Data 1', 'Data 2'],
 *   { onClick: () => showDetails() }
 * );
 */
function safeCreateTableRow(cells, options = {}) {
    const row = document.createElement('tr');

    // Add CSS class if provided
    if (options.className) {
        row.className = options.className;
    }

    // Add click handler if provided
    if (options.onClick) {
        row.addEventListener('click', options.onClick);
        row.style.cursor = 'pointer';
    }

    // Create cells
    cells.forEach(cellData => {
        let cell;

        if (typeof cellData === 'object' && cellData !== null) {
            // Cell with configuration
            cell = safeCreateElement('td', cellData.text, {
                className: cellData.className,
                attributes: cellData.attributes,
                style: cellData.style
            });

            // Allow child elements if provided
            if (cellData.children) {
                cellData.children.forEach(child => {
                    if (child instanceof HTMLElement) {
                        cell.appendChild(child);
                    }
                });
            }
        } else {
            // Simple text cell
            cell = safeCreateElement('td', cellData);
        }

        row.appendChild(cell);
    });

    return row;
}

/**
 * Safely clear and populate a container element
 *
 * @param {HTMLElement|string} container - Container element or element ID
 * @param {HTMLElement|HTMLElement[]|string} content - Content to insert
 *
 * @example
 * // Clear and add single element
 * safeClearAndPopulate('table-body', newRow);
 *
 * // Clear and add multiple elements
 * safeClearAndPopulate(tableBody, [row1, row2, row3]);
 *
 * // Clear and show message
 * safeClearAndPopulate('results', 'No data available');
 */
function safeClearAndPopulate(container, content) {
    // Get container element
    const containerEl = typeof container === 'string'
        ? document.getElementById(container)
        : container;

    if (!containerEl) {
        console.error('Container element not found:', container);
        return;
    }

    // Clear existing content
    containerEl.innerHTML = '';

    // Add new content
    if (Array.isArray(content)) {
        // Array of elements
        content.forEach(item => {
            if (item instanceof HTMLElement) {
                containerEl.appendChild(item);
            }
        });
    } else if (content instanceof HTMLElement) {
        // Single element
        containerEl.appendChild(content);
    } else if (typeof content === 'string') {
        // Text content
        containerEl.textContent = content;
    }
}

/**
 * Safely create a status badge element
 *
 * @param {string} status - Status text (e.g., 'ACTIVE', 'PENDING', 'FAILED')
 * @param {string} className - Base CSS class name (default: 'status-badge')
 * @returns {HTMLSpanElement} - Status badge element
 *
 * @example
 * const badge = safeCreateStatusBadge('ACTIVE', 'status-badge success');
 * const badge = safeCreateStatusBadge('PENDING_DEPOSIT', 'status-badge pending-deposit');
 */
function safeCreateStatusBadge(status, className = 'status-badge') {
    const statusText = status || 'UNKNOWN';
    const statusClass = statusText.toLowerCase().replace(/_/g, '-');

    return safeCreateElement('span', statusText, {
        className: `${className} ${statusClass}`
    });
}

/**
 * Safely create a container div with optional child elements
 *
 * @param {string} className - CSS class name(s)
 * @param {HTMLElement[]} children - Child elements to append
 * @returns {HTMLDivElement} - Container div
 *
 * @example
 * const container = safeCreateContainer('batch-info', [
 *   safeCreateElement('h3', 'Batch Details'),
 *   safeCreateElement('p', 'Organization: Smith & Sons')
 * ]);
 */
function safeCreateContainer(className, children = []) {
    const div = document.createElement('div');
    div.className = className;

    children.forEach(child => {
        if (child instanceof HTMLElement) {
            div.appendChild(child);
        }
    });

    return div;
}

/**
 * Safely create an empty state message for tables
 *
 * @param {string} message - Message to display
 * @param {number} colspan - Number of columns to span
 * @returns {HTMLTableRowElement} - Empty state row
 *
 * @example
 * const emptyRow = safeCreateEmptyState('No organizations found', 8);
 * tableBody.appendChild(emptyRow);
 */
function safeCreateEmptyState(message, colspan) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');

    cell.setAttribute('colspan', String(colspan));
    cell.style.textAlign = 'center';
    cell.style.padding = '40px';
    cell.style.color = 'var(--text-secondary)';
    cell.textContent = message;

    row.appendChild(cell);
    return row;
}

/**
 * Safely create a clickable link element
 *
 * @param {string} text - Link text
 * @param {string|Function} href - URL or click handler function
 * @param {Object} options - Optional configuration
 * @returns {HTMLAnchorElement} - Safe link element
 *
 * @example
 * // External link
 * const link = safeCreateLink('View Details', 'https://example.com');
 *
 * // Click handler
 * const link = safeCreateLink('Edit', () => openEditModal(id));
 */
function safeCreateLink(text, href, options = {}) {
    const link = document.createElement('a');
    link.textContent = text;

    if (typeof href === 'function') {
        // Click handler
        link.href = '#';
        link.addEventListener('click', (e) => {
            e.preventDefault();
            href();
        });
    } else {
        // URL
        link.href = href;
    }

    if (options.className) {
        link.className = options.className;
    }

    if (options.target) {
        link.setAttribute('target', options.target);
    }

    return link;
}

/**
 * Safely set text content on an existing element
 *
 * @param {string|HTMLElement} element - Element or element ID
 * @param {string|number|null} text - Text to set
 *
 * @example
 * safeSetText('org-display', organizationName);
 * safeSetText(document.getElementById('total'), 42);
 */
function safeSetText(element, text) {
    const el = typeof element === 'string'
        ? document.getElementById(element)
        : element;

    if (el) {
        el.textContent = text !== null && text !== undefined ? String(text) : '';
    } else {
        console.error('Element not found:', element);
    }
}

/**
 * Test function to verify XSS protection
 * Run this in browser console to verify security
 *
 * @example
 * testXSSProtection(); // Logs test results to console
 */
function testXSSProtection() {
    console.group('🔒 XSS Protection Tests');

    const testCases = [
        {
            name: 'Special Characters',
            input: 'Smith & Sons "Property" Ltd',
            expected: 'Smith & Sons "Property" Ltd'
        },
        {
            name: 'Script Tag',
            input: '<script>alert("XSS")</script>',
            expected: '<script>alert("XSS")</script> (displayed as text)'
        },
        {
            name: 'Event Handler',
            input: '<img src=x onerror="alert(1)">',
            expected: '<img src=x onerror="alert(1)"> (displayed as text)'
        },
        {
            name: 'HTML Injection',
            input: '<div onclick="malicious()">Click</div>',
            expected: '<div onclick="malicious()">Click</div> (displayed as text)'
        }
    ];

    testCases.forEach(test => {
        const element = safeCreateElement('div', test.input);
        const actual = element.textContent;
        const safe = !element.querySelector('script') && actual === test.input;

        console.log(`${safe ? '✅' : '❌'} ${test.name}`);
        console.log(`   Input: "${test.input}"`);
        console.log(`   Output: "${actual}"`);
        console.log(`   Safe: ${safe}`);
    });

    console.groupEnd();
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        safeCreateElement,
        safeCreateTableRow,
        safeClearAndPopulate,
        safeCreateStatusBadge,
        safeCreateContainer,
        safeCreateEmptyState,
        safeCreateLink,
        safeSetText,
        testXSSProtection
    };
}
