// GitHub exposes an action input as INPUT_<NAME>, uppercased with spaces turned
// into underscores — dashes are kept. Getting this wrong fails at runtime only,
// with the input visibly present in the log, so it is worth its own module.

export const envName = (name) => `INPUT_${name.replace(/ /g, "_").toUpperCase()}`;

export function readInput(name, env = process.env) {
  const v = env[envName(name)];
  if (v !== undefined) return v;
  // Running the file by hand is easier with underscores; accept them too.
  return env[`INPUT_${name.replace(/[ -]/g, "_").toUpperCase()}`] ?? "";
}

export const readBool = (name, fallback, env = process.env) => {
  const v = readInput(name, env).trim().toLowerCase();
  return v === "" ? fallback : v === "true";
};

export const readNum = (name, fallback, env = process.env) => {
  const v = parseFloat(readInput(name, env));
  return Number.isFinite(v) ? v : fallback;
};
