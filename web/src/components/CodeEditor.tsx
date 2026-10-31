import Editor, { loader } from "@monaco-editor/react";
import "monaco-editor/esm/vs/editor/edcore.main";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import "monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution";
import "monaco-editor/esm/vs/basic-languages/ini/ini.contribution";
import "monaco-editor/esm/vs/basic-languages/shell/shell.contribution";
import "monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution";
import "monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution";
import "monaco-editor/esm/vs/basic-languages/xml/xml.contribution";
import "monaco-editor/esm/vs/language/json/monaco.contribution";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";

// Bundle Monaco locally: the CSP allows no third-party script CDNs.
self.MonacoEnvironment = {
  getWorker: (_: string, label: string) => (label === "json" ? new JsonWorker() : new EditorWorker()),
};
loader.config({ monaco });

const LANGUAGES: Record<string, string> = {
  yml: "yaml",
  yaml: "yaml",
  json: "json",
  json5: "json",
  mcmeta: "json",
  properties: "ini",
  toml: "ini",
  cfg: "ini",
  conf: "ini",
  ini: "ini",
  sh: "shell",
  js: "javascript",
  md: "markdown",
  xml: "xml",
};

export function languageFor(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return LANGUAGES[ext] ?? "plaintext";
}

export default function CodeEditor({
  value,
  onChange,
  fileName,
  onSave,
}: {
  value: string;
  onChange: (v: string) => void;
  fileName: string;
  onSave: () => void;
}) {
  const dark = document.documentElement.classList.contains("dark");
  return (
    <Editor
      height="100%"
      language={languageFor(fileName)}
      value={value}
      theme={dark ? "vs-dark" : "vs"}
      onChange={(v) => onChange(v ?? "")}
      onMount={(editor) => {
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, onSave);
        editor.focus();
      }}
      options={{
        fontFamily: '"JetBrains Mono Variable", ui-monospace, monospace',
        fontSize: 13,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        wordWrap: "on",
        tabSize: 2,
        renderWhitespace: "boundary",
        automaticLayout: true,
      }}
    />
  );
}
