// The default taxonomy.
//
// The description is the whole question — the model judges against these words,
// not against the label name. The first pass of the benchmark scored 73%, and
// almost every disagreement was one of three confusions: a support question
// written as a malfunction, a documentation gap reported as a defect, and a
// missing capability filed as a bug. Each line below exists to separate one of
// those, which is why they name what they are NOT.

export const DEFAULT_LABELS = {
  bug: "The project itself misbehaves: something that used to work, or is documented to work, does not. There is a defect in the code. Not a misunderstanding of how to use it, and not a capability that was never built.",
  feature: "A request for behaviour the project does not have yet. The project is not broken — the person wants it to do something more, or differently.",
  docs: "The documentation, README, examples or error messages are missing, wrong, outdated or unclear. The code may be working correctly; what failed is the explanation of it.",
  question: "Someone asking how to use the project, why it behaves the way it does, or for help with their own setup. Often written as if something is broken, but the project is working as designed and what is needed is guidance.",
};
