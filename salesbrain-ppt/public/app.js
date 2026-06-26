document.getElementById('deckForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const btn = document.getElementById('generateBtn');
  const btnText = btn.querySelector('.btn-text');
  const spinner = document.getElementById('spinner');
  const statusMsg = document.getElementById('statusMsg');

  // Set loading state
  btn.disabled = true;
  btnText.textContent = 'Orchestrating Presentation...';
  spinner.style.display = 'block';
  statusMsg.textContent = 'Claude is planning your deck. This may take up to 60 seconds.';

  // Build Payload
  const payload = {
    client: {
      name: document.getElementById('clientName').value,
      industry: document.getElementById('clientIndustry').value,
      pain_points: document.getElementById('painPoints').value.split(',').map(s => s.trim()),
      size: document.getElementById('clientSize').value ? parseInt(document.getElementById('clientSize').value) : null,
      budget_range: document.getElementById('budgetRange').value
    },
    our_company: {
      products: document.getElementById('products').value.split(',').map(s => s.trim()),
      differentiators: document.getElementById('differentiators').value.split(',').map(s => s.trim()),
      case_studies: document.getElementById('caseStudyTitle').value ? [
        {
          title: document.getElementById('caseStudyTitle').value,
          outcome: document.getElementById('caseStudyOutcome').value
        }
      ] : [],
      tagline: document.getElementById('tagline').value
    },
    alignment_score: parseInt(document.getElementById('alignmentScore').value),
    recommended_angle: document.getElementById('recommendedAngle').value,
    deck_goal: document.getElementById('deckGoal').value
  };

  try {
    const response = await fetch('/build-deck', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to generate presentation');
    }

    // Handle File Download
    const data = await response.json();
    if (data.downloadUrl) {
      window.location.href = data.downloadUrl;
    }

    statusMsg.textContent = 'Success! Your presentation has been downloaded.';
    statusMsg.style.color = '#14b8a6'; // Teal
  } catch (error) {
    console.error('Error:', error);
    statusMsg.textContent = `Error: ${error.message}`;
    statusMsg.style.color = '#f43f5e'; // Coral
  } finally {
    // Reset loading state
    btn.disabled = false;
    btnText.textContent = 'Generate Presentation';
    spinner.style.display = 'none';
  }
});

document.getElementById('extractBtn').addEventListener('click', async () => {
  const rawText = document.getElementById('rawTextInput').value;
  if (!rawText) return;

  const btn = document.getElementById('extractBtn');
  const btnText = btn.querySelector('.btn-text');
  const spinner = document.getElementById('extractSpinner');
  const msg = document.getElementById('extractMsg');

  btn.disabled = true;
  btnText.textContent = 'Extracting...';
  spinner.style.display = 'block';
  msg.textContent = 'Analyzing text and filling form...';
  msg.style.color = 'var(--text-secondary)';

  try {
    const res = await fetch('/extract-payload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: rawText })
    });
    
    if (!res.ok) throw new Error('Failed to extract data');
    const data = await res.json();
    
    if (data.client_name) document.getElementById('clientName').value = data.client_name;
    if (data.client_industry) document.getElementById('clientIndustry').value = data.client_industry;
    if (data.pain_points && data.pain_points.length) document.getElementById('painPoints').value = data.pain_points.join(', ');
    if (data.client_size) document.getElementById('clientSize').value = data.client_size;
    if (data.budget_range) document.getElementById('budgetRange').value = data.budget_range;
    
    if (data.products && data.products.length) document.getElementById('products').value = data.products.join(', ');
    if (data.differentiators && data.differentiators.length) document.getElementById('differentiators').value = data.differentiators.join(', ');
    if (data.case_study_title) document.getElementById('caseStudyTitle').value = data.case_study_title;
    if (data.case_study_outcome) document.getElementById('caseStudyOutcome').value = data.case_study_outcome;
    if (data.tagline) document.getElementById('tagline').value = data.tagline;
    
    if (data.alignment_score) document.getElementById('alignmentScore').value = data.alignment_score;
    if (data.recommended_angle) document.getElementById('recommendedAngle').value = data.recommended_angle;
    if (data.deck_goal) document.getElementById('deckGoal').value = data.deck_goal;

    msg.textContent = 'Extraction complete! Please review the fields below.';
    msg.style.color = 'var(--accent-primary)';
  } catch (err) {
    console.error(err);
    msg.textContent = err.message;
    msg.style.color = 'var(--accent-secondary)';
  } finally {
    btn.disabled = false;
    btnText.textContent = 'Auto-Extract Details';
    spinner.style.display = 'none';
  }
});