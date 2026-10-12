use super::*;

const JB_REGULAR: &[u8] = include_bytes!("../../../fonts/JetBrainsMono-Regular.ttf");
const JB_BOLD: &[u8] = include_bytes!("../../../fonts/JetBrainsMono-Bold.ttf");

fn jb(path: &str, data: &[u8]) -> Entry {
    entry(Path::new(path), 0, data).expect("bundled font has names")
}

#[test]
fn reads_family_style_and_weight_from_the_name_table() {
    let r = jb("r.ttf", JB_REGULAR);
    assert_eq!(r.display, "JetBrains Mono");
    assert!(r.families.contains(&"jetbrains mono".to_string()));
    assert_eq!((r.weight, r.italic, r.wght), (400, false, None));
    let b = jb("b.ttf", JB_BOLD);
    assert_eq!((b.weight, b.italic), (700, false));
}

#[test]
fn matching_is_case_and_space_insensitive_and_misses_are_empty() {
    let es = [jb("r.ttf", JB_REGULAR), jb("b.ttf", JB_BOLD)];
    assert_eq!(matching(&es, "  JETBRAINS mono ").len(), 2);
    assert!(matching(&es, "No Such Family 9000").is_empty());
    assert!(matching(&es, "").is_empty());
}

#[test]
fn static_files_are_picked_by_matching_weight() {
    let es = [jb("r.ttf", JB_REGULAR), jb("b.ttf", JB_BOLD)];
    let m = matching(&es, "JetBrains Mono");
    let (reg, v) = pick(&m, 0).unwrap();
    assert_eq!(
        (reg.path.as_path(), v.is_empty()),
        (Path::new("r.ttf"), true)
    );
    assert_eq!(pick(&m, BOLD).unwrap().0.path, Path::new("b.ttf"));
    // No italic file: falls back to the closest upright one rather than failing.
    assert!(pick(&m, ITALIC).is_some());
}

#[test]
fn variable_weight_and_italic_axes_drive_the_variations() {
    let var = |italic, ital_axis| Entry {
        path: "v.ttf".into(),
        index: 0,
        families: vec!["x".into()],
        display: "X".into(),
        weight: 400,
        italic,
        wght: Some((100.0, 800.0)),
        ital_axis,
        slnt_axis: false,
    };
    let (up, italic) = (var(false, false), var(true, false));
    let m = [&up];
    assert_eq!(pick(&m, 0).unwrap().1, vec![("wght", 400.0)]);
    assert_eq!(pick(&m, BOLD).unwrap().1, vec![("wght", 700.0)]);
    // Bold clamps into the axis range.
    let narrow = Entry {
        wght: Some((300.0, 600.0)),
        ..var(false, false)
    };
    assert_eq!(pick(&[&narrow], BOLD).unwrap().1, vec![("wght", 600.0)]);
    // A separate italic file wins over synthesizing slant; an `ital` axis beats none.
    let both = [&up, &italic];
    assert!(pick(&both, ITALIC).unwrap().0.italic);
    let with_axis = var(false, true);
    assert_eq!(
        pick(&[&with_axis], BOLD | ITALIC).unwrap().1,
        vec![("wght", 700.0), ("ital", 1.0)]
    );
}

#[test]
fn unknown_families_resolve_to_the_bundled_font() {
    let r = resolve_in(&[], &["Nope One".to_string(), "Nope Two".to_string()]);
    assert!(r.family.is_none() && r.matched.is_none());
    assert!(resolve(&[]).family.is_none());
}

#[test]
fn scanning_a_directory_finds_fonts_and_ignores_the_rest() {
    let dir = std::env::temp_dir().join(format!("atlas-term-fonts-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("JB-Regular.ttf"), JB_REGULAR).unwrap();
    std::fs::write(dir.join("JB-Bold.ttf"), JB_BOLD).unwrap();
    std::fs::write(dir.join("broken.ttf"), b"not a font").unwrap();
    std::fs::write(dir.join("notes.txt"), b"hi").unwrap();
    let es = scan(std::slice::from_ref(&dir));
    assert_eq!(es.len(), 2, "{es:?}");
    let fam = build_family(&es, "jetbrains MONO").expect("family");
    assert_eq!(fam.name, "JetBrains Mono");
    assert!(fam.faces[0].coords.is_empty());
    // Distinct files for regular and bold; every face parses.
    assert_ne!(
        fam.faces[0].font().data.len(),
        fam.faces[1].font().data.len()
    );
    assert!(fam.faces.iter().all(|f| f.font().charmap().map('A') != 0));
    let r = resolve_in(&es, &["Nope".into(), "JetBrains Mono".into()]);
    assert_eq!(r.matched, Some(1));
    std::fs::remove_dir_all(&dir).unwrap();
}

/// The user's variable Fira Code: one file, both weights through `wght`. Skipped when absent.
#[test]
fn variable_fira_code_resolves_regular_and_bold() {
    let Some(home) = std::env::var_os("HOME") else {
        return;
    };
    let path = Path::new(&home).join("Library/Fonts/fira-code-variable.ttf");
    if !path.exists() {
        eprintln!("no {}, skipping", path.display());
        return;
    }
    let es = scan_file(&path);
    assert_eq!(matching(&es, "fira code").len(), es.len());
    assert!(!es.is_empty(), "family name must be Fira Code");
    let fam = build_family(&es, "Fira Code").expect("family");
    assert_eq!(fam.name, "Fira Code");
    let (reg, bold) = (&fam.faces[0], &fam.faces[1]);
    assert_ne!(reg.coords, bold.coords, "bold must move the wght axis");
    let wght = reg
        .font()
        .variations()
        .find_by_tag(tag_from_bytes(b"wght"))
        .expect("wght axis");
    let at = |c: &TextFace| {
        let i = wght.index();
        c.coords.get(i).copied().unwrap_or(0)
    };
    assert!(at(bold) > at(reg));
    // 700 sits above the default (400): a normalized coordinate beyond the default of 0.
    assert!(at(bold) > 0);
}
