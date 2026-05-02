export type EvaluationNotificationJson = {
  ID: string;
  Type: string;
  Message: string;
  Timestamp: string;
};

export function formatNotificationTypeForEvaluation(type: string): string {
  const t = type.trim().toLowerCase();
  if (t === "placement") return "Placement";
  if (t === "result") return "Result";
  if (t === "event") return "Event";
  return type;
}

export function toEvaluationNotificationJson(row: {
  ID: string;
  Type: string;
  Message: string;
  Timestamp: string;
}): EvaluationNotificationJson {
  return {
    ID: row.ID,
    Type: formatNotificationTypeForEvaluation(row.Type),
    Message: row.Message,
    Timestamp: row.Timestamp,
  };
}

export function stringifyNotificationsEvaluationResponse(
  rows: EvaluationNotificationJson[]
): string {
  const body = {
    notifications: rows.map((r) => ({
      ID: r.ID,
      Type: r.Type,
      Message: r.Message,
      Timestamp: r.Timestamp,
    })),
  };
  return JSON.stringify(body);
}
