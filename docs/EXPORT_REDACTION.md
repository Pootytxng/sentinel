# Export Snapshot: the exact redaction rules

Backed by these tests in `src-tauri/src/export.rs`: `no_canary_survives_in_any_shape_of_either_tier`,
`counts_are_given_by_class_and_are_right`, `qos_policy_names_in_the_readiness_row_are_numbered_like_the_hardware_list_and_appear_nowhere`,
`a_custom_plan_whose_name_contains_ultimate_or_high_performance_is_replaced_wherever_a_plan_name_sits`,
`a_stock_plan_name_keeps_its_name_even_with_a_guid_windows_does_not_ship`,
`a_slash_is_a_path_separator_only_inside_a_path_not_anywhere_in_a_string_that_holds_one`,
`a_network_adapter_name_in_a_ledger_snapshot_is_numbered_and_the_word_stays_in_text`,
`common_first_names_are_not_ordinary_words_so_a_pc_named_after_one_is_replaced_everywhere`,
`every_field_of_the_exported_enums_is_classified_and_a_new_variant_field_fails_this_test`,
`a_spaced_name_is_taken_whole_at_the_end_of_a_value_and_before_a_period_colon_comma_or_curly_quote`,
`path_scrub_edge_cases_apostrophe_spaces_short_8_3_unc_slashes_escapes_drives_and_shared_profiles`,
`a_onedrive_company_name_becomes_organization_and_personal_stays`,
`an_ordinary_word_computer_name_from_any_export_text_leaves_the_text_whole_and_a_coded_name_goes_everywhere`,
`a_scoped_name_beside_a_forward_slash_is_replaced_only_in_a_path_and_a_unc_share_is_covered`,
`a_computer_or_user_named_with_a_skip_list_word_never_corrupts_the_text`,
`every_field_of_the_exported_records_is_classified_here_and_a_new_one_fails_this_test`,
`a_one_or_two_letter_qos_policy_name_leaves_the_readiness_row_as_the_labelled_list`,
`a_spaced_name_inside_a_sentence_is_only_partly_replaced`,
`a_long_unc_profile_path_loses_the_account_name`,
`a_non_ascii_account_name_is_replaced_and_never_cut_inside_a_character`,
`a_moved_profile_folder_is_matched_by_its_real_leaf_name_scoped_or_not`,
`a_long_space_free_string_of_paths_is_matched_in_linear_time`.

The ordinary-word list the rules above use is `src-tauri/src/export_words.txt`, generated from the
non-test string literals of the report's source files; `export_words_txt_is_the_current_list_from_the_sources`
fails, naming the refresh command, when it is stale, and `no_program_code_embeds_source_text` keeps source
text out of the program.

This is the detailed version of the export paragraph in `docs/PRIVACY.md`. The Export Snapshot holds your
hardware and driver names, your network adapters (an adapter's name can name a VPN you use), the changes
Compy made, and, for each recorded session, the game's program name, when you played and how it ran. Before
the report is written, Compy changes these things in the copy it exports:

## Programs

- Programs that started during a game session (the event labels and the stutter sentence), and startup
  entries you changed through Compy, are named only when they are on Compy's reviewed list of known
  programs (recorders, overlays, launchers, browsers, chat and meeting apps, a torrent client, developer
  tools, Windows Update). Any other program there is shown as "other program 1", "other program 2" and so
  on, the same program keeping its number within one report, with counts and timing kept.

## Your names

- Your Windows user name, your profile folder's name, your user domain and your computer name are replaced
  with `<user>` or `<host>`, in any letter case, as a whole word (a letter or digit beside it makes it part
  of a longer word). A name with a digit, hyphen, dot or space in it, or whose letters are not a word that
  Compy's own report text uses (for example DESKTOP-4F2K9Q), is replaced everywhere it appears. A name that
  is shorter than three letters, is one of 28 common words (for example Admin, User, Owner, Max, Gamer), or
  is a single ordinary word that Compy's own report text uses (a computer named Ethernet or Hardware, say)
  is replaced only in Windows file and network paths (next to a backslash, or next to a forward slash inside
  a path, including `\\NAME\share` and `//NAME/share`) and in the name fields (hostname, computer name,
  machine name, domain, user name), and is left as it is in running text; the last lines of the report say
  how many other places it was left in. The path rule in one sentence: a path starts at a drive, a
  network-path start or `file:`, always ends at `" < > |` or a line break, and ends at a comma, a semicolon,
  or a full stop, colon, `!` or `?` followed by a space unless a slash of a kind the path has already used
  comes before the next line break, quote or `< > |`, so `C:/Games/Hello, World, Again/Max/save.dat` is one path while in
  `C:\a.txt; Power/Performance` the path ends at the semicolon. This can go wrong both ways: a backslash path
  whose folder name holds a comma and whose next separator is a forward slash (`C:\Games\Hello, World/Max/x`)
  ends at the comma, so a name after it is left as it is; and prose after a forward-slash path that has a `/`
  anywhere before the next line break, quote or `< > |` can lose a word to `<user>` or `<host>`.
  A name that is also an everyday word of Compy's report text (Max, Will, May or Major, for example) stays
  in running text: it is replaced only in the name fields and next to a path separator.
  "Compy's own report text" means the fixed words of Compy's report, readiness, hardware, diagnostics,
  recommendation, ledger, drift and session text; a name that only Windows supplies is not in it.

## Paths

- In a path under `\Users\<name>` (any drive or network share, either slash, doubled or JSON-escaped
  slashes, and the `\\?\` and `file:///` forms) another account's name is replaced with `<user>`, except
  the shared Public, Default, Default User and All Users profiles, which are not a person's. The name ends
  at a slash, a straight or curly quote, or one of `< > | * ?`. A spaced name that ends at a closing
  bracket, comma, semicolon, or a period or colon followed by a space or the end, is taken whole if it is
  at most 32 characters and cut at its first space if it is longer, so a later word of a long spaced name
  stays. When the path begins the value and nothing marks the end of the name, the rest of the value is
  taken, up to 48 characters, and cut at its first space if longer; inside a sentence with no end mark only
  the first word is taken, so a spaced name followed by plain words there keeps the words after its first.
  The period or colon that ended the name stays, and an apostrophe inside a name belongs to it. A OneDrive
  folder named `OneDrive - <company>` is shown as `OneDrive - <organization>` (`OneDrive - Personal` stays),
  with the company ending by the same rules.

## Ids and QoS policy names

- The id of each change in the Trust Ledger is replaced by "change 1", "change 2" and so on, because an id
  carries the name of a startup entry you changed. QoS policy names are replaced by "QoS policy 1", "QoS
  policy 2" and so on, the same number wherever the name appears (the hardware list and the Network QoS
  row of Game Readiness); a policy name of one or two letters is replaced in the list and inside that row's
  parenthesised list of names (the row then reads "(QoS policy 1, QoS policy 2)", like the hardware list),
  not in other text.
- A network adapter's Windows name (which you can change, for example to name a VPN or a room) is saved in
  the Trust Ledger's record of an Energy-Efficient Ethernet change. In the export it is replaced there by
  "adapter-1", "adapter-2" and so on, the same name keeping its number within one report; it is not
  searched for in other text.

## Power plans

- A power plan name stays only when its id is one of the four plans Windows ships, or when the name is
  exactly Balanced, High performance, Power saver or Ultimate performance (a row that carries no id is
  judged by the plan Windows reports as active). A plan Windows ships keeps whatever name it has on your
  PC, so a Windows plan you renamed keeps the name you gave it. Any other name, including a custom one that contains "Ultimate" or "High
  performance", is shown as "a custom power plan" in the places a plan name sits: the power rows of Game
  Readiness and Diagnostics, the Drift Watch values, a name beside a plan id, and a Trust Ledger row that
  carries a custom plan id. The ids of custom power plans and network interfaces are replaced by numbered
  labels. The copy of Ultimate Performance that Compy makes keeps its name only when the name is exactly
  Ultimate performance: Compy records the copy's id but not its name, so it cannot tell a copy Windows
  named in another language from one you renamed, and both are shown as "a custom power plan".

## Left out

- The list of known programs that were already running when a game started, the computer-name field and
  any game-state field a newer Compy adds without being reviewed are left out.

## What stays

The game's program name, the hardware and network adapter names in the hardware list (an adapter is named
there by its model, and by its Windows name only when no model can be read), the stock Windows power plan names, the
hardware fingerprint (a short code made from the hardware names that are already in the report), and
anything you type into the note box, exactly as you wrote it: if you type your name there, it stays.

## What is not reached

Free text is searched only for your own Windows user, profile, domain and computer names and for the names
and ids named above, so a name of yours typed elsewhere is not found; a name of yours that is an ordinary
word stays in running text; a text value is rewritten but an object key in the JSON is not (the keys
are the field names Compy writes: no field of an exported record is a map keyed by text, the game-state
keys are cut to a fixed list, and a Trust Ledger change's undo record has the field names of Compy's own
record types, or for a change recorded by an older Compy that build's fixed setting names;
`every_field_of_the_exported_records_is_classified_here_and_a_new_one_fails_this_test` fails if a record
gains a map keyed by text or another free-form JSON field); and another
account's name is found only in a `\Users\` path. The last lines of the Markdown, and a `redaction` section
in the JSON, say how many names, ids and paths were changed. Nothing changes in what Compy records on your
PC or shows you in the app; only the exported copy is altered. Read a report before you post it in public:
it is made to help someone diagnose your PC, not to be anonymous.
