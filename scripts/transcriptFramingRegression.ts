import assert from "node:assert/strict";
import {
  buildQuestionWindowHash,
  frameQuestionWindow,
  questionSupersedes,
} from "../shared/questionDetection";
import { enqueueQuestion, getUnanswered } from "../server/realtime/meetingStore";
import { getRecentQuestionHistory, recordInterviewerQuestion } from "../server/assist/sessionState";

function run(): void {
  const direct = frameQuestionWindow("Tell me about yourself.");
  assert.equal(direct.answerability, "complete");
  assert.equal(direct.questions[0]?.text, "Tell me about yourself?");

  const oneWord = frameQuestionWindow("Python");
  assert.equal(oneWord.answerability, "fragment");
  assert.equal(oneWord.questions.length, 0);

  const multi = frameQuestionWindow("What is Python? Tell me about yourself.");
  assert.equal(multi.answerability, "complete");
  assert.ok(multi.questions.length >= 2, "expected multi-question framing");

  const followup = frameQuestionWindow("Why?", { previousQuestion: "Tell me about yourself?" });
  assert.equal(followup.answerability, "fragment");
  assert.equal(followup.anchor, "previous_answer");

  assert.ok(questionSupersedes("Tell me about yourself?", "Tell me about"));
  assert.equal(
    buildQuestionWindowHash("Tell me about yourself."),
    buildQuestionWindowHash("Tell me about yourself."),
  );

  const meetingId = `regression-meeting-${Date.now()}`;
  enqueueQuestion(meetingId, "Tell me about", Date.now(), {
    answerability: "fragment",
  });
  enqueueQuestion(meetingId, "Tell me about yourself?", Date.now() + 1, {
    answerability: "complete",
    windowHash: buildQuestionWindowHash("Tell me about yourself?"),
  });
  const unanswered = getUnanswered(meetingId, 5);
  assert.equal(unanswered.length, 1);
  assert.equal(unanswered[0]?.clean, "Tell me about yourself?");

  const sessionId = `regression-session-${Date.now()}`;
  recordInterviewerQuestion(sessionId, "Tell me about");
  recordInterviewerQuestion(sessionId, "Tell me about yourself?", Date.now() + 1);
  const history = getRecentQuestionHistory(sessionId, 5);
  assert.equal(history[0]?.text, "Tell me about yourself?");

  console.log("transcript framing regression: ok");
}

run();
