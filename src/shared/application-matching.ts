/** Independent OR legs: combining process_name and process_path would require BOTH to match. */
export function applicationProcessMatchers(preset: {
  processNames?: string[];
  processPaths?: string[];
  processPathRegex?: string[];
}): Array<{
  process_name?: string[];
  process_path?: string[];
  process_path_regex?: string[];
}> {
  const rules = [];
  if (preset.processNames?.length) rules.push({ process_name: preset.processNames });
  if (preset.processPaths?.length) rules.push({ process_path: preset.processPaths });
  if (preset.processPathRegex?.length) rules.push({ process_path_regex: preset.processPathRegex });
  return rules;
}
