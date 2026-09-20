export type DecisionState = string | Record<string, unknown> | unknown[];

export type DecisionQuestions = Record<string, unknown>;

export type DecisionRequest = {
  model: string;
  state: DecisionState;
  questions: DecisionQuestions;
};

export type DecisionResponse = {
  model: string;
  answers: Record<string, unknown>;
  [key: string]: unknown;
};
