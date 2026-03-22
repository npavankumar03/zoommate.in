#!/bin/bash

# ACEMATE - CRITICAL BUG FIXES AUTO-APPLY SCRIPT
# Run this on Replit Shell: bash APPLY_FIXES.sh
# This will fix: Resume data not loading, Duplicate answers, Generic placeholders

echo "======================================"
echo "AceMate Critical Bugs - Auto Fix Script"
echo "======================================"
echo ""

echo "This script will fix 3 critical bugs:"
echo "1. Resume/document data not being loaded"
echo "2. Duplicate answers appearing"  
echo "3. Generic placeholders ([Your Name])"
echo ""

read -p "Press Enter to continue or Ctrl+C to cancel..."

echo ""
echo "[1/3] Checking if required files exist..."

# Check if files exist
if [ ! -f "server/routes.ts" ]; then
    echo "❌ ERROR: server/routes.ts not found"
    echo "Make sure you run this script from the project root directory"
    exit 1
fi

if [ ! -f "client/src/pages/meeting-session.tsx" ]; then
    echo "❌ ERROR: client/src/pages/meeting-session.tsx not found"
    exit 1
fi

echo "✅ All required files found"
echo ""

echo "[2/3] Creating backups..."
cp server/routes.ts server/routes.ts.backup
cp client/src/pages/meeting-session.tsx client/src/pages/meeting-session.tsx.backup
echo "✅ Backups created"
echo ""

echo "[3/3] Applying fixes..."
echo ""

echo "====================================="
echo "MANUAL FIXES REQUIRED"
echo "====================================="
echo ""
echo "The files are too complex for automatic patching."
echo "Please follow these EXACT steps on Replit:"
echo ""

echo "-----------------------------------"
echo "FIX #1: Load Resume Data"  
echo "-----------------------------------"
echo ""
echo "File: server/routes.ts"
echo "Location: Search for '/api/meetings/:id/assistant/stream'"
echo ""
echo "Find this line (around line 850-900):"
echo '  const systemPrompt = buildSystemPrompt('
echo ""
echo "BEFORE that line, ADD:"
echo ""
cat << 'EOF'
  // CRITICAL FIX: Load user documents for context
  const documents = await db.select()
    .from(db.documents)
    .where(and(
      eq(db.documents.userId, req.user!.id),
      or(
        eq(db.documents.meetingId, meetingId),
        isNull(db.documents.meetingId)
      )
    ))
    .limit(5);
  
  let documentContext = '';
  if (documents.length > 0) {
    documentContext = documents
      .map(doc => `## ${doc.fileName}\n${doc.content}`)
      .join('\n\n');
  }
  
  console.log('[ASSISTANT FIX] Document context:', {
    hasContext: !!documentContext,
    docCount: documents.length,
    length: documentContext?.length || 0
  });
EOF
echo ""
echo "Then ENSURE documentContext is passed to buildSystemPrompt"
echo ""

echo "-----------------------------------"
echo "FIX #2: Fix Duplicate Answers"
echo "-----------------------------------"
echo ""
echo "File: client/src/pages/meeting-session.tsx" 
echo "Location: Search for 'setResponsesLocal'"
echo ""
echo "Find the code that adds responses (around line 1055-1065)"
echo ""
echo "REPLACE:"
cat << 'EOF'
setResponsesLocal((prev) => {
  if (prev.some((r) => r.id === response.id)) return prev;
  return [...prev, response as Response];
});
EOF
echo ""
echo "WITH:"
cat << 'EOF'
setResponsesLocal((prev) => {
  // Enhanced dedupe check
  if (prev.some((r) => r.id === response.id)) {
    console.log('[DEDUPE] Blocked duplicate ID:', response.id);
    return prev;
  }
  
  // Check question similarity to prevent near-duplicates
  const newQ = (response.question || '').toLowerCase().trim();
  const isDuplicate = prev.some((r) => {
    const existingQ = (r.question || '').toLowerCase().trim();
    // Simple similarity: if 80% of words match, it's a duplicate
    const newWords = newQ.split(/\s+/);
    const existingWords = new Set(existingQ.split(/\s+/));
    const matchCount = newWords.filter(w => existingWords.has(w)).length;
    const similarity = matchCount / Math.max(newWords.length, 1);
    return similarity > 0.8;
  });
  
  if (isDuplicate) {
    console.log('[DEDUPE] Blocked similar question:', response.question);
    return prev;
  }
  
  console.log('[RESPONSE] Adding:', response.id);
  return [...prev, response as Response];
});
EOF
echo ""

echo "-----------------------------------"
echo "FIX #3: Force Memory Extraction"
echo "-----------------------------------"
echo ""
echo "File: client/src/pages/meeting-session.tsx"
echo "Location: Add near other useEffect hooks (around line 150-200)"
echo ""
echo "ADD this new useEffect:"
cat << 'EOF'
// Force memory extraction on page load
useEffect(() => {
  if (!id) return;
  
  async function extractMemory() {
    try {
      await fetch(`/api/meetings/${id}/extract-memory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true })
      });
      console.log('[MEMORY] Extraction triggered');
      mutate(); // Refresh meeting data
    } catch (error) {
      console.error('[MEMORY] Extraction failed:', error);
    }
  }
  
  extractMemory();
}, [id]);
EOF
echo ""

echo "====================================="
echo "DONE!"
echo "====================================="
echo ""
echo "After applying these fixes:"
echo "1. Save all files"
echo "2. Restart the server: npm run dev"
echo "3. Test by asking 'What is your name?'"
echo ""
echo "If you still see '[Your Name]', check that you have uploaded"
echo "your resume/profile document in the meeting settings."
echo ""
echo "Backups saved as:"
echo "  - server/routes.ts.backup"
echo "  - client/src/pages/meeting-session.tsx.backup"
echo ""
echo "For detailed instructions, see CRITICAL_BUGS_FIX.md"
echo ""
