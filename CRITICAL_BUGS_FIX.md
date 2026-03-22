# CRITICAL BUGS - IMMEDIATE FIXES NEEDED

**Date**: February 28, 2026  
**Priority**: P0 - BLOCKING  
**Status**: Production broken

## Issues Reported

1. **❌ Not using actual name from resume** - Shows "[Your Name]" instead of real name
2. **❌ Duplicate answers** - Same answer appearing twice for same question
3. **❌ Generic responses** - Not pulling user-specific data from uploaded resume

---

## Root Cause Analysis

### Issue 1: Resume Data Not Being Loaded

**File**: `server/routes.ts` - Assistant stream endpoint  
**Problem**: The `documentContext` parameter in `buildSystemPrompt()` is either:
- Not fetching user documents from database
- Passing `null` or empty string
- Document extraction logic failing

**Evidence from prompt.ts**[web:3]:
```typescript
const hasDocuments = !!documentContext && documentContext.trim().length > 0;
```

This check is failing, causing generic placeholders.

### Issue 2: Duplicate Answers (Dedupe Failure)

**File**: `client/src/pages/meeting-session.tsx`  
**Problem**: The dedupe logic using `responsesLocal` array is broken:

From commit 47285be, line 532 was changed to:
```typescript
const newest = responsesLocal[responsesLocal.length - 1];
```

And line 1062:
```typescript
return [...prev, response as Response];
```

**But** the dedupe check at line 1061 is failing:
```typescript
if (prev.some((r) => r.id === response.id)) return prev;
```

This suggests either:
- Response IDs are not matching correctly
- Multiple responses being created with different IDs for same question
- Race condition in answer generation

### Issue 3: Memory Slots Not Being Used

**File**: `server/memoryExtractor.ts`  
**Problem**: Memory slots (name, employer, role) should be extracted from resume but aren't being:
1. Loaded into prompt
2. Or extracted correctly from uploaded documents

---

## IMMEDIATE FIXES

### Fix 1: Ensure Resume Data is Loaded

**File to edit**: `server/routes.ts`

Find the `/api/meetings/:id/assistant/stream` endpoint and verify:

```typescript
// Around line 800-900, find the assistant stream endpoint

app.post("/api/meetings/:id/assistant/stream", async (req, res) => {
  // ... existing code ...
  
  // ADD THIS: Load user's uploaded documents
  const userDocuments = await db.select()
    .from(documents)
    .where(and(
      eq(documents.userId, req.user!.id),
      eq(documents.meetingId, meetingId)
    ));
  
  // Build document context
  let documentContext = '';
  if (userDocuments.length > 0) {
    documentContext = userDocuments
      .map(doc => `## ${doc.fileName}\\n${doc.content}`)
      .join('\\n\\n');
  }
  
  // If no meeting-specific docs, load user's default profile/resume
  if (!documentContext) {
    const profileDocs = await db.select()
      .from(documents)
      .where(and(
        eq(documents.userId, req.user!.id),
        isNull(documents.meetingId) // Default documents
      ))
      .limit(3);
    
    if (profileDocs.length > 0) {
      documentContext = profileDocs
        .map(doc => `## ${doc.fileName}\\n${doc.content}`)
        .join('\\n\\n');
    }
  }
  
  console.log('[ASSISTANT] Document context loaded:', {
    hasContext: !!documentContext,
    length: documentContext?.length || 0,
    userId: req.user!.id,
    meetingId
  });
  
  // CRITICAL: Pass documentContext to buildSystemPrompt
  const systemPrompt = buildSystemPrompt(
    responseFormat,
    meeting.meetingType,
    customInstructions,
    documentContext, // <-- ENSURE THIS IS PASSED
    conversationContext,
    memoryContext,
    rollingSummary,
    interviewStyle
  );
  
  // ... rest of streaming logic ...
});
```

### Fix 2: Fix Duplicate Answer Dedupe

**File to edit**: `client/src/pages/meeting-session.tsx`

Find the dedupe logic (around line 1055-1065):

```typescript
// REPLACE THIS:
if (!response?.id) return;
setResponsesLocal((prev) => {
  if (prev.some((r) => r.id === response.id)) return prev;
  return [...prev, response as Response];
});

// WITH THIS:
if (!response?.id) return;

// Enhanced dedupe: Check both ID and question similarity
const questionFingerprint = normalizeForDedup(response.question || '');

setResponsesLocal((prev) => {
  // Check for exact ID match
  if (prev.some((r) => r.id === response.id)) {
    console.log('[DEDUPE] Blocked duplicate response ID:', response.id);
    return prev;
  }
  
  // Check for question similarity (prevent near-duplicates)
  const similarExists = prev.some((r) => {
    const existingFingerprint = normalizeForDedup(r.question || '');
    const similarity = levenshteinSimilarity(
      questionFingerprint,
      existingFingerprint
    );
    return similarity > 0.85; // 85% similar = duplicate
  });
  
  if (similarExists) {
    console.log('[DEDUPE] Blocked similar question:', response.question);
    return prev;
  }
  
  console.log('[RESPONSE] Adding new response:', response.id);
  return [...prev, response as Response];
});
```

### Fix 3: Force Memory Extraction on Page Load

**File to edit**: `client/src/pages/meeting-session.tsx`

Add this useEffect near other initialization code (around line 150):

```typescript
// Extract memory slots immediately when session starts
useEffect(() => {
  if (!id) return;
  
  async function extractMemoryOnLoad() {
    try {
      console.log('[MEMORY] Extracting memory slots for meeting:', id);
      
      const response = await fetch(`/api/meetings/${id}/extract-memory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true })
      });
      
      if (response.ok) {
        const data = await response.json();
        console.log('[MEMORY] Memory slots extracted:', data.slots);
        
        // Refresh meeting data to get latest memory slots
        mutate();
      }
    } catch (error) {
      console.error('[MEMORY] Failed to extract memory:', error);
    }
  }
  
  extractMemoryOnLoad();
}, [id]);
```

### Fix 4: Add Debug Logging

**File to edit**: `server/routes.ts` in the assistant stream endpoint

Add debug logs to track what's being passed:

```typescript
console.log('[ASSISTANT DEBUG]', {
  hasDocumentContext: !!documentContext,
  documentLength: documentContext?.length || 0,
  hasMemoryContext: !!memoryContext,
  memorySlots: meeting.memorySlots,
  question: cleanQuestion
});
```

---

## Testing Checklist

After implementing fixes:

- [ ] **Upload resume/profile document** in meeting settings or user profile
- [ ] **Verify document appears** in database (check `documents` table)
- [ ] **Start meeting** and check server logs for "[ASSISTANT DEBUG]"
- [ ] **Ask "What is your name?"** 
  - Expected: Real name from resume
  - NOT: "[Your Name]"
- [ ] **Ask same question twice**
  - Expected: Only ONE answer appears
  - NOT: Two identical answers
- [ ] **Ask "What is your previous experience?"**
  - Expected: Specific company names, projects from resume
  - NOT: Generic "Tech Innovations" placeholder

---

## Quick Verification Commands

```bash
# On Replit Shell:

# 1. Check if documents exist for user
echo "SELECT id, fileName, userId, meetingId FROM documents WHERE userId = 1;" | sqlite3 .data/sqlite.db

# 2. Check meeting memory slots
echo "SELECT id, memorySlots FROM meetings WHERE id = 'YOUR_MEETING_ID';" | sqlite3 .data/sqlite.db

# 3. Restart with debug logs
npm run dev
# Watch for [ASSISTANT DEBUG] logs when answering questions
```

---

## Emergency Workaround (if fixes take time)

**Manually set memory slots** via API:

```bash
curl -X POST https://your-replit-url.repl.co/api/meetings/YOUR_MEETING_ID/memory-slots \\
  -H "Content-Type: application/json" \\
  -d '{
    "employer": "Your Company Name",
    "role_title": "Senior Software Engineer",
    "tech_stack": "JavaScript, React, Node.js, AWS"
  }'
```

---

## Next Steps

1. **Implement Fix 1** (document loading) - HIGHEST PRIORITY
2. **Implement Fix 2** (dedupe) - HIGH PRIORITY
3. **Test with real resume upload**
4. **Verify memory extraction** is working
5. **Monitor logs** for any remaining issues

---

**Last Updated**: Feb 28, 2026 14:30 IST  
**Author**: AI Assistant (Comet)  
**Urgency**: CRITICAL - Production is broken
