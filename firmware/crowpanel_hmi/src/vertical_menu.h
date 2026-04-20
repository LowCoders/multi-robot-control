#pragma once

#include <Arduino.h>

#include <vector>

struct VerticalMenuItem {
  String label;
  String value;  // empty -> show only the label (no value column)
};

struct VerticalMenuOpts {
  int   maxVisible = 5;
  int   labelColW  = 0;     // 0 = auto (longest label); >0 = fixed width
  bool  showCursor = true;
  char  cursorOn   = '>';
  char  cursorOff  = ' ';
};

inline String renderVerticalMenu(const std::vector<VerticalMenuItem> &items,
                                 int selected,
                                 const VerticalMenuOpts &opts = {}) {
  const int total = static_cast<int>(items.size());
  if (total == 0) return String();

  if (selected < 0) selected = 0;
  if (selected >= total) selected = total - 1;

  const int visCount = total < opts.maxVisible ? total : opts.maxVisible;
  int winStart = selected - visCount / 2;
  if (winStart < 0) winStart = 0;
  if (winStart > total - visCount) winStart = total - visCount;

  size_t labelW = static_cast<size_t>(opts.labelColW);
  bool anyValue = false;
  for (int v = 0; v < visCount; v++) {
    const auto &it = items[winStart + v];
    if (!it.value.isEmpty()) anyValue = true;
    if (opts.labelColW == 0 && it.label.length() > labelW) {
      labelW = it.label.length();
    }
  }

  String out;
  for (int v = 0; v < visCount; v++) {
    int idx = winStart + v;
    const auto &it = items[idx];
    if (v > 0) out += '\n';
    if (opts.showCursor) {
      out += (idx == selected) ? opts.cursorOn : opts.cursorOff;
      out += ' ';
    }
    out += it.label;
    if (anyValue && !it.value.isEmpty()) {
      out += ':';
      // After "label:" pad with spaces so all value columns align.
      // Target column = labelW (longest label) + 2 (": " width).
      size_t pos = it.label.length() + 1;
      size_t target = labelW + 2;
      while (pos < target) { out += ' '; pos++; }
      out += it.value;
    }
  }
  return out;
}
