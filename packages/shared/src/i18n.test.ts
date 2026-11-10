import { describe, expect, it } from "@effect/vitest";

import { resolveAppLocale, translate } from "./i18n.ts";

describe("resolveAppLocale", () => {
  it("keeps an explicit language", () => {
    expect(resolveAppLocale("zh-CN", ["en-US"])).toBe("zh-CN");
    expect(resolveAppLocale("en", ["zh-CN"])).toBe("en");
  });

  it("follows a Chinese system language", () => {
    expect(resolveAppLocale("system", ["zh-CN", "en-US"])).toBe("zh-CN");
    expect(resolveAppLocale("system", ["zh-Hans-CN"])).toBe("zh-CN");
  });

  it("uses English when the system language is not Chinese", () => {
    expect(resolveAppLocale("system", ["en-US"])).toBe("en");
    expect(resolveAppLocale("system", [])).toBe("en");
  });
});

describe("translate", () => {
  it("returns Simplified Chinese for known interface copy", () => {
    expect(translate("zh-CN", "New thread")).toBe("新建会话");
    expect(translate("zh-CN", "Interface language")).toBe("界面语言");
    expect(translate("zh-CN", "Could not check for updates")).toBe("无法检查更新");
    expect(translate("zh-CN", "Rename thread")).toBe("重命名会话");
    expect(translate("zh-CN", "Side chat")).toBe("侧边会话");
    expect(translate("zh-CN", "Linked pull requests")).toBe("已关联的拉取请求");
    expect(translate("zh-CN", "Close {title}", { title: "Diff" })).toBe("关闭 Diff");
  });

  it("keeps English copy and unknown strings", () => {
    expect(translate("en", "New thread")).toBe("New thread");
    expect(translate("zh-CN", "Not in the catalog")).toBe("Not in the catalog");
  });

  it("fills named placeholders", () => {
    expect(translate("zh-CN", "New thread in {name}", { name: "t3code" })).toBe(
      "在 t3code 中新建会话",
    );
    expect(translate("zh-CN", "Reset {label} to default", { label: "时间格式" })).toBe(
      "将时间格式恢复为默认",
    );
  });
});
