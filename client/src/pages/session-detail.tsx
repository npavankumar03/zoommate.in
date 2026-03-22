import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft } from "lucide-react";
import type { Meeting, Response, TranscriptTurn } from "@shared/schema";

function formatDateTime(value: unknown) {
  if (!value) return "-";
  const parsed = new Date(value as any);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString();
}

export default function SessionDetail({ params }: { params: { id: string } }) {
  const meetingId = params.id;

  const { data: meeting, isLoading: meetingLoading } = useQuery<Meeting>({
    queryKey: [`/api/meetings/${meetingId}`],
  });

  const { data: responses = [], isLoading: responsesLoading } = useQuery<Response[]>({
    queryKey: [`/api/meetings/${meetingId}/responses`],
    enabled: !!meetingId,
  });

  const { data: transcriptTurns = [], isLoading: transcriptLoading } = useQuery<TranscriptTurn[]>({
    queryKey: [`/api/meetings/${meetingId}/transcript-turns`],
    enabled: !!meetingId,
  });

  if (meetingLoading) {
    return <div className="min-h-screen bg-background p-8">Loading...</div>;
  }

  if (!meeting) {
    return <div className="min-h-screen bg-background p-8">Session not found.</div>;
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        <Link href="/dashboard?tab=sessions">
          <Button variant="outline" className="gap-2">
            <ArrowLeft className="w-4 h-4" />
            Back to Sessions
          </Button>
        </Link>

        <div className="space-y-2">
          <h1 className="text-4xl font-bold tracking-tight">
            {meeting.title} - {formatDateTime(meeting.createdAt)}
          </h1>
        </div>

        <Card className="overflow-hidden">
          <div className="px-6 py-5 border-b">
            <h2 className="text-xl font-semibold">Session Content</h2>
          </div>

          <Tabs defaultValue="transcript" className="w-full">
            <div className="px-6 pt-4">
              <TabsList className="grid w-fit grid-cols-2">
                <TabsTrigger value="transcript">Transcript</TabsTrigger>
                <TabsTrigger value="responses">AI Responses</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="transcript" className="p-6 pt-4">
              <div className="grid grid-cols-[70px_1fr_180px] gap-4 px-6 py-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b">
                <div>No</div>
                <div>Transcript</div>
                <div>Time</div>
              </div>
              {transcriptLoading ? (
                <div className="p-6 text-sm text-muted-foreground">Loading transcript...</div>
              ) : transcriptTurns.length ? (
                transcriptTurns.map((turn, index) => (
                  <div key={turn.id} className="grid grid-cols-[70px_1fr_180px] gap-4 px-6 py-4 border-b last:border-b-0 items-start">
                    <div className="text-muted-foreground">{index + 1}</div>
                    <div className="text-base leading-7 break-words">
                      {turn.speaker ? `${turn.speaker}: ` : ""}{turn.text}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {formatDateTime(turn.createdAt)}
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-10 text-center text-sm text-muted-foreground">No transcript saved for this session.</div>
              )}
            </TabsContent>

            <TabsContent value="responses" className="p-6 pt-4">
              <div className="grid grid-cols-[70px_1fr_180px] gap-4 px-6 py-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b">
                <div>No</div>
                <div>Response</div>
                <div>Time</div>
              </div>
              {responsesLoading ? (
                <div className="p-6 text-sm text-muted-foreground">Loading responses...</div>
              ) : responses.length ? (
                responses.map((response, index) => (
                  <div key={response.id} className="grid grid-cols-[70px_1fr_180px] gap-4 px-6 py-4 border-b last:border-b-0 items-start">
                    <div className="text-muted-foreground">{index + 1}</div>
                    <div className="space-y-2 break-words">
                      <div className="text-base leading-7">{response.answer}</div>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {formatDateTime(response.createdAt)}
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-10 text-center text-sm text-muted-foreground">No AI responses saved for this session.</div>
              )}
            </TabsContent>
          </Tabs>
        </Card>
      </div>
    </div>
  );
}
