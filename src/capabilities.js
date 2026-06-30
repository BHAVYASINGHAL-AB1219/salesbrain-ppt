// src/capabilities.js
const QUARKS_CAPABILITIES = [
    // AI / ML
    { id: 1, title: 'Agentic AI in Service Operations', practice: 'AI / ML', signal: 'Hot in 2026', keywords: ['automation', 'resolution', 'service desk', 'ticketing', 'queue', 'AI', 'autonomous'] },
    { id: 2, title: 'AI Governance & Responsible Automation', practice: 'AI / ML', signal: 'Hot in 2026', keywords: ['governance', 'compliance', 'EU AI Act', 'NIST', 'responsible', 'risk', 'regulation'] },
    { id: 3, title: 'AIOps & Predictive Incident Prevention', practice: 'AI / ML', signal: 'Rising fast', keywords: ['incident', 'prevention', 'monitoring', 'proactive', 'operations', 'downtime', 'reliability'] },
    { id: 4, title: 'AI-Powered Knowledge Management', practice: 'AI / ML', signal: 'Rising fast', keywords: ['knowledge', 'KB', 'articles', 'self-service', 'documentation', 'support'] },
    { id: 11, title: 'Multi-Agent AI Orchestration', practice: 'AI / ML', signal: 'Emerging', keywords: ['multi-agent', 'orchestration', 'workflow', 'automation', 'coordination'] },

    // Data Engineering
    { id: 5, title: 'CMDB as Trusted Data Foundation', practice: 'Data Engineering', signal: 'Core / enduring', keywords: ['CMDB', 'data', 'foundation', 'configuration', 'asset', 'visibility'] },
    { id: 6, title: 'Unified ITSM + ITAM + ITOM Platform', practice: 'Data Engineering', signal: 'Core / enduring', keywords: ['ITSM', 'ITAM', 'ITOM', 'platform', 'unified', 'tool sprawl', 'consolidation'] },
    { id: 7, title: 'IT Asset Management Modernisation', practice: 'Data Engineering', signal: 'Rising fast', keywords: ['asset', 'ITAM', 'cloud', 'hybrid', 'visibility', 'inventory', 'lifecycle'] },
    { id: 16, title: 'CX Observability & Service Reliability', practice: 'Data Engineering', signal: 'Core / enduring', keywords: ['observability', 'reliability', 'monitoring', 'CX', 'service', 'uptime'] },

    // Business Transformation
    { id: 8, title: 'Workflow Automation & Hyperautomation', practice: 'Business Transformation', signal: 'Core / enduring', keywords: ['workflow', 'automation', 'RPA', 'low-code', 'manual', 'process', 'efficiency'] },
    { id: 9, title: 'Enterprise Service Management (ESM)', practice: 'Business Transformation', signal: 'Rising fast', keywords: ['ESM', 'enterprise', 'HR', 'finance', 'legal', 'service management', 'shared services'] },
    { id: 12, title: 'Service Catalogue Modernisation', practice: 'Business Transformation', signal: 'Emerging', keywords: ['catalogue', 'catalog', 'self-service', 'fulfilment', 'portal', 'request'] },
    { id: 14, title: 'Outcome-Based Service Value Metrics', practice: 'Business Transformation', signal: 'Emerging', keywords: ['metrics', 'KPI', 'outcomes', 'value', 'ROI', 'business impact', 'reporting'] },
    { id: 18, title: 'Continual Service Improvement (CSI)', practice: 'Business Transformation', signal: 'Core / enduring', keywords: ['improvement', 'CSI', 'ITIL', 'maturity', 'optimisation', 'cycles'] },

    // Cybersecurity
    { id: 17, title: 'Zero Trust Integration in ITSM', practice: 'Cybersecurity & Compliance', signal: 'Hot in 2026', keywords: ['zero trust', 'security', 'cybersecurity', 'identity', 'access', 'control', 'ITSM'] },
    { id: 19, title: 'Geopolitical & Sovereignty-Aware ITSM', practice: 'Cybersecurity & Compliance', signal: 'Emerging', keywords: ['DORA', 'NIS2', 'sovereignty', 'compliance', 'geopolitical', 'regulation', 'vendor'] },

    // Product & Experience
    { id: 10, title: 'Self-Service & Conversational AI Portals', practice: 'Product & Experience', signal: 'Rising fast', keywords: ['self-service', 'chatbot', 'conversational', 'Teams', 'Slack', 'WhatsApp', 'portal'] },
    { id: 13, title: 'Experience Level Agreements (XLAs)', practice: 'Product & Experience', signal: 'Emerging', keywords: ['XLA', 'experience', 'sentiment', 'effort', 'SLA', 'employee satisfaction'] },
    { id: 15, title: 'Employee Experience Design (EX-first)', practice: 'Product & Experience', signal: 'Core / enduring', keywords: ['employee experience', 'EX', 'human-centred', 'design', 'UX', 'effort', 'trust'] },

    // ESG
    { id: 20, title: 'Sustainability Metrics in Service Delivery', practice: 'ESG & Governance', signal: 'Emerging', keywords: ['sustainability', 'ESG', 'carbon', 'e-waste', 'ITAM', 'reporting', 'green'] },
];

// Matches top N capabilities to client pain points + industry
function matchCapabilities(payload, topN = 6) {
    const searchText = [
        payload.client?.industry || '',
        payload.client?.pain_points?.join(' ') || '',
        payload.recommended_angle || '',
        payload.our_company?.products?.join(' ') || '',
    ].join(' ').toLowerCase();

    const scored = QUARKS_CAPABILITIES.map(cap => {
        let score = 0;

        // Keyword match against all client context
        cap.keywords.forEach(kw => {
            if (searchText.includes(kw.toLowerCase())) score += 3;
        });

        // Boost Hot/Rising signals — client sees current thinking
        if (cap.signal === 'Hot in 2026') score += 2;
        if (cap.signal === 'Rising fast') score += 1;

        // Boost if practice area matches industry
        const industryPracticeMap = {
            'fintech': ['AI / ML', 'Cybersecurity & Compliance', 'Data Engineering'],
            'banking': ['AI / ML', 'Cybersecurity & Compliance', 'Data Engineering'],
            'healthcare': ['Cybersecurity & Compliance', 'Data Engineering', 'Business Transformation'],
            'retail': ['Product & Experience', 'Business Transformation', 'Data Engineering'],
            'manufacturing': ['Data Engineering', 'Business Transformation', 'AI / ML'],
            'telecom': ['Data Engineering', 'AI / ML', 'Product & Experience'],
            'insurance': ['AI / ML', 'Cybersecurity & Compliance', 'Business Transformation'],
        };
        const industry = (payload.client?.industry || '').toLowerCase();
        const boostedPractices = Object.entries(industryPracticeMap)
            .find(([key]) => industry.includes(key))?.[1] || [];
        if (boostedPractices.includes(cap.practice)) score += 2;

        return { ...cap, score };
    });

    // Sort by score, return topN
    return scored
        .sort((a, b) => b.score - a.score)
        .slice(0, topN)
        .map(c => `${c.title}: ${c.signal} — ${c.practice}`);
}

module.exports = { matchCapabilities, QUARKS_CAPABILITIES };