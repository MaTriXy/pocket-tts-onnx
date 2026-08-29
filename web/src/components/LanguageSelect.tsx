import { Combobox, Group, Text, useCombobox } from "@mantine/core";
import { IconCheck, IconChevronDown, IconWorld } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export interface LanguageOption {
  value: string;
  label: string;
  flag?: string;
}

/**
 * The language the text is spoken in, as a box you can type into.
 *
 * Closed, it reads as a chip: a globe and the current name. Open, the same
 * box becomes a search field, so a list that may one day be long is still one
 * keystroke away from the right entry.
 */
export function LanguageSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: LanguageOption[];
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const combobox = useCombobox({
    onDropdownOpen: () => {
      setSearch("");
      combobox.focusTarget();
      combobox.updateSelectedOptionIndex("active");
    },
    onDropdownClose: () => {
      setSearch("");
      combobox.resetSelectedOption();
    },
  });

  const current = options.find((option) => option.value === value) ?? options[0];
  const query = search.trim().toLowerCase();
  const shown = query ? options.filter((option) => option.label.toLowerCase().includes(query)) : options;

  useEffect(() => {
    if (combobox.dropdownOpened) inputRef.current?.select();
  }, [combobox.dropdownOpened]);

  return (
    <Combobox
      store={combobox}
      position="bottom-start"
      width={220}
      offset={6}
      withinPortal
      onOptionSubmit={(next) => {
        onChange(next);
        combobox.closeDropdown();
      }}
      classNames={{ dropdown: "lang-dropdown", option: "lang-option" }}
    >
      <Combobox.Target>
        <div
          className="lang-box"
          data-open={combobox.dropdownOpened}
          onClick={() => combobox.openDropdown()}
        >
          <IconWorld size={15} className="lang-globe" />
          <input
            ref={inputRef}
            className="lang-input"
            value={combobox.dropdownOpened ? search : current.label}
            onChange={(event) => {
              setSearch(event.currentTarget.value);
              combobox.openDropdown();
              // Enter takes the first match, so typing three letters is enough.
              combobox.selectFirstOption();
            }}
            onFocus={() => combobox.openDropdown()}
            onBlur={() => combobox.closeDropdown()}
            placeholder={current.label}
            aria-label={t("app.speechLanguage")}
            spellCheck={false}
            autoComplete="off"
          />
          <IconChevronDown size={13} className="lang-chevron" />
        </div>
      </Combobox.Target>

      <Combobox.Dropdown>
        <Combobox.Options>
          {shown.length === 0 && <Combobox.Empty>{t("app.modes.none")}</Combobox.Empty>}
          {shown.map((option) => (
            <Combobox.Option key={option.value} value={option.value} active={option.value === value}>
              <Group gap={10} wrap="nowrap" justify="space-between">
                <Group gap={10} wrap="nowrap">
                  <span className="lang-flag">
                    {option.flag ?? <IconWorld size={15} />}
                  </span>
                  <Text size="sm" fw={option.value === value ? 600 : 450}>
                    {option.label}
                  </Text>
                </Group>
                {option.value === value && <IconCheck size={14} />}
              </Group>
            </Combobox.Option>
          ))}
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  );
}
