import assert from "node:assert/strict";
import {
  buildQuestionWindowHash,
  frameQuestionWindow,
  questionSupersedes,
  resolveActiveQuestionWindow,
} from "../shared/questionDetection";
import { enqueueQuestion, getActiveQuestion, getUnanswered, setActiveQuestion } from "../server/realtime/meetingStore";
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

  const mergedTopicTail = resolveActiveQuestionWindow("And AWS.", {
    previousQuestion: "Do you have experience with Azure?",
  });
  assert.equal(mergedTopicTail.answerability, "complete");
  assert.equal(mergedTopicTail.cleanQuestion, "Do you have experience with Azure and AWS?");

  const mergedDrillDown = resolveActiveQuestionWindow("Explain more.", {
    previousQuestion: "How does the storage account work?",
  });
  assert.equal(mergedDrillDown.answerability, "complete");
  assert.equal(mergedDrillDown.cleanQuestion, "Explain more about how does the storage account work?");

  const imperativeCoding = resolveActiveQuestionWindow(
    "Next, write a Python function that reads a Json file and extracts all unique keys present in it.",
    { previousQuestion: "How would you ensure fault tolerance if one service becomes unavailable?" },
  );
  assert.equal(imperativeCoding.answerability, "complete");
  assert.equal(
    imperativeCoding.cleanQuestion,
    "Write a Python function that reads a Json file and extracts all unique keys present in it?",
  );

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

  setActiveQuestion(meetingId, "Tell me about yourself?", Date.now() + 2, { answerability: "complete" });
  const active = getActiveQuestion(meetingId);
  assert.equal(active?.clean, "Tell me about yourself?");

  const sessionId = `regression-session-${Date.now()}`;
  recordInterviewerQuestion(sessionId, "Tell me about");
  recordInterviewerQuestion(sessionId, "Tell me about yourself?", Date.now() + 1);
  const history = getRecentQuestionHistory(sessionId, 5);
  assert.equal(history[0]?.text, "Tell me about yourself?");

  console.log("transcript framing regression: ok");
}

run();
