import { alpha, createTheme, type Theme } from '@mui/material/styles';
import designTokens from '../../uidesign.json';

/**
 * Sole mapping of uidesign.json → MUI theme.
 * All colors, type sizes, radii, elevations come from tokens.
 */

type ThemeMode = 'dark' | 'light';

const t = designTokens;

export const operatorTokens = t.operator;
export const radii = t.radii;
export const motion = t.motion;

/** Card / table / paper radius — preferred over theme.shape for surfaces. */
export const viewRadius = t.radii.card;

/** Map chrome colors from the active (dark) token set. */
export const mapTokens = t.palette.dark.map;

type PaletteBlock = (typeof t.palette)['dark'];

function buildShadows(mode: ThemeMode): Theme['shadows'] {
  const elev = t.elevation[mode];
  const rest = Array.from({ length: 20 }, () => elev.level4);
  return [
    elev.level0,
    elev.level1,
    elev.level2,
    elev.level3,
    elev.level4,
    ...rest,
  ] as Theme['shadows'];
}

/** Shared ambient canvas used by login + platform pages. */
export const canvasBackground = (theme: Theme): string => `
  radial-gradient(ellipse 90% 70% at 0% -5%, ${alpha(theme.palette.primary.main, 0.12)} 0%, transparent 55%),
  radial-gradient(ellipse 60% 50% at 100% 105%, ${alpha(theme.palette.primary.dark, 0.1)} 0%, transparent 50%),
  linear-gradient(180deg, ${theme.palette.background.default} 0%, ${alpha(theme.palette.background.paper, 0.4)} 100%)
`;

function createAppTheme(mode: ThemeMode): Theme {
  const p: PaletteBlock = t.palette[mode];
  const elev = t.elevation[mode];
  const headerHeight = t.operator.headerHeightPx;
  const touch = t.operator.touchTargetMinPx;
  const { primary, secondary, background, text, error, warning, success, info } = p;
  const border = p.border;
  const surface = p.surface;
  const ms = `${t.motion.normal}ms`;
  const msFast = `${t.motion.fast}ms`;

  return createTheme({
    palette: {
      mode,
      primary: p.primary,
      secondary: p.secondary,
      error: p.error,
      warning: p.warning,
      info: p.info,
      success: p.success,
      background: p.background,
      text: {
        primary: text.primary,
        secondary: text.secondary,
        disabled: text.disabled,
      },
      divider: border,
      action: {
        hover: alpha(primary.main, mode === 'dark' ? 0.1 : 0.06),
        selected: alpha(primary.main, mode === 'dark' ? 0.16 : 0.1),
        disabled: text.disabled,
        disabledBackground: alpha(text.disabled, 0.12),
        focus: alpha(primary.main, 0.22),
      },
    },
    typography: {
      fontFamily: t.typography.fontFamily,
      fontSize: t.typography.fontSize,
      h1: { ...t.typography.h1, letterSpacing: '-0.03em' },
      h2: { ...t.typography.h2, letterSpacing: '-0.025em' },
      h3: { ...t.typography.h3, letterSpacing: '-0.02em' },
      h4: { ...t.typography.h4, letterSpacing: '-0.02em' },
      h5: { ...t.typography.h5, letterSpacing: '-0.015em' },
      h6: { ...t.typography.h6, letterSpacing: '-0.01em' },
      body1: t.typography.body1,
      body2: t.typography.body2,
      caption: { ...t.typography.caption, letterSpacing: '0.01em', color: text.muted },
      overline: {
        fontSize: t.typography.caption.fontSize,
        fontWeight: 600,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        lineHeight: 1.5,
      },
      button: {
        fontSize: t.typography.button.fontSize,
        fontWeight: t.typography.button.fontWeight,
        textTransform: t.typography.button.textTransform as 'none',
        letterSpacing: '0.01em',
      },
    },
    spacing: t.spacingUnit,
    shape: { borderRadius: t.radii.card },
    shadows: buildShadows(mode),
    transitions: {
      duration: {
        shortest: t.motion.fast,
        shorter: t.motion.fast,
        short: t.motion.normal,
        standard: t.motion.normal,
        complex: t.motion.slow,
        enteringScreen: t.motion.normal,
        leavingScreen: t.motion.fast,
      },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          html: { height: '100%' },
          body: {
            height: '100%',
            backgroundColor: background.default,
            color: text.primary,
            WebkitFontSmoothing: 'antialiased',
            MozOsxFontSmoothing: 'grayscale',
          },
          '#root': { minHeight: '100%', height: '100%' },
          '::-webkit-scrollbar': { width: 8, height: 8 },
          '::-webkit-scrollbar-thumb': {
            backgroundColor: alpha(text.secondary, 0.28),
            borderRadius: t.radii.pill,
            border: `2px solid ${background.default}`,
          },
          '::-webkit-scrollbar-track': { backgroundColor: 'transparent' },
          '::selection': { backgroundColor: alpha(primary.main, 0.32) },
          // Browser autofill paints a bright slab; force token surface colors.
          'input:-webkit-autofill, input:-webkit-autofill:hover, input:-webkit-autofill:focus, input:-webkit-autofill:active':
            {
              WebkitTextFillColor: `${text.primary} !important`,
              caretColor: text.primary,
              transition: 'background-color 99999s ease-out 0s',
              boxShadow: `0 0 0 1000px ${surface.sunken} inset !important`,
              WebkitBoxShadow: `0 0 0 1000px ${surface.sunken} inset !important`,
            },
          '.MuiDataGrid-root': {
            borderRadius: `${t.radii.card}px !important`,
            borderColor: `${border} !important`,
            backgroundColor: background.paper,
          },
          '.MuiDataGrid-columnHeaders': {
            backgroundColor: alpha(surface.sunken, 0.95),
            borderBottom: `1px solid ${border} !important`,
          },
          '.MuiDataGrid-columnHeaderTitle': {
            fontWeight: 600,
            fontSize: t.typography.caption.fontSize,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: text.secondary,
          },
          '.MuiDataGrid-cell': { borderBottomColor: `${border} !important` },
          '.MuiDataGrid-footerContainer': { borderTop: `1px solid ${border}` },
          '.MuiDataGrid-row:hover': {
            backgroundColor: `${alpha(primary.main, mode === 'dark' ? 0.06 : 0.04)} !important`,
          },
          '.MuiDataGrid-row.Mui-selected': {
            backgroundColor: `${alpha(primary.main, mode === 'dark' ? 0.12 : 0.08)} !important`,
          },
        },
      },
      MuiAppBar: {
        defaultProps: { elevation: 0, color: 'transparent' },
        styleOverrides: {
          root: {
            minHeight: headerHeight,
            backgroundColor: alpha(background.paper, mode === 'dark' ? 0.82 : 0.9),
            backdropFilter: 'blur(20px) saturate(1.3)',
            borderBottom: `1px solid ${border}`,
            color: text.primary,
          },
        },
      },
      MuiToolbar: {
        styleOverrides: {
          root: {
            minHeight: `${headerHeight}px !important`,
            gap: t.spacingUnit,
          },
          dense: { minHeight: `${headerHeight}px !important` },
        },
      },
      MuiTabs: {
        styleOverrides: {
          root: { minHeight: headerHeight },
          indicator: {
            height: 2,
            borderRadius: t.radii.pill,
            backgroundColor: primary.main,
          },
          flexContainer: { gap: 4 },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: {
            minHeight: headerHeight,
            minWidth: 'auto',
            paddingLeft: t.spacingUnit * 2,
            paddingRight: t.spacingUnit * 2,
            fontWeight: 500,
            fontSize: t.typography.body2.fontSize,
            color: text.muted,
            opacity: 1,
            transition: `color ${msFast} ease, background-color ${msFast} ease`,
            borderRadius: `${t.radii.control}px ${t.radii.control}px 0 0`,
            '&.Mui-selected': { color: text.primary, fontWeight: 600 },
            '&:hover': {
              color: text.primary,
              backgroundColor: alpha(primary.main, 0.06),
            },
          },
        },
      },
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            backgroundColor: background.paper,
            borderRadius: t.radii.card,
          },
          outlined: {
            borderColor: border,
            boxShadow: elev.level1,
          },
          elevation1: { boxShadow: elev.level1 },
          elevation2: { boxShadow: elev.level2 },
          elevation3: { boxShadow: elev.level3 },
          elevation4: { boxShadow: elev.level4 },
        },
      },
      MuiCard: {
        defaultProps: { elevation: 0, variant: 'outlined' },
        styleOverrides: {
          root: {
            borderRadius: t.radii.card,
            borderColor: border,
            backgroundColor: background.paper,
            boxShadow: elev.level1,
            transition: `border-color ${ms} ease, box-shadow ${ms} ease, transform ${ms} ease`,
            '&:hover': {
              borderColor: alpha(primary.main, 0.35),
              boxShadow: elev.level2,
            },
          },
        },
      },
      MuiCardContent: {
        styleOverrides: {
          root: {
            padding: t.spacingUnit * 3,
            '&:last-child': { paddingBottom: t.spacingUnit * 3 },
          },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: {
            minHeight: touch,
            borderRadius: t.radii.button,
            paddingLeft: t.spacingUnit * 2.5,
            paddingRight: t.spacingUnit * 2.5,
            fontWeight: 600,
            transition: `background-color ${msFast} ease, border-color ${msFast} ease, box-shadow ${msFast} ease, transform ${msFast} ease`,
            '&:active': { transform: 'scale(0.98)' },
            '&.Mui-focusVisible': {
              outline: `2px solid ${alpha(primary.main, 0.55)}`,
              outlineOffset: 2,
            },
          },
          containedPrimary: {
            backgroundColor: primary.main,
            boxShadow: `0 1px 0 ${alpha('#fff', 0.08)}, 0 4px 12px ${alpha(primary.main, 0.28)}`,
            '&:hover': {
              backgroundColor: primary.light,
              boxShadow: `0 1px 0 ${alpha('#fff', 0.1)}, 0 6px 16px ${alpha(primary.main, 0.36)}`,
            },
            '&.Mui-disabled': {
              backgroundColor: alpha(text.disabled, 0.2),
              color: text.disabled,
            },
          },
          containedSecondary: {
            backgroundColor: secondary.main,
            color: secondary.contrastText,
            '&:hover': { backgroundColor: secondary.light },
          },
          containedError: {
            backgroundColor: error.main,
            '&:hover': { backgroundColor: error.dark },
          },
          outlined: {
            borderColor: border,
            backgroundColor: alpha(background.paper, 0.5),
            '&:hover': {
              borderColor: alpha(primary.main, 0.5),
              backgroundColor: alpha(primary.main, 0.08),
            },
          },
          outlinedError: {
            borderColor: alpha(error.main, 0.5),
            color: error.main,
            '&:hover': {
              borderColor: error.main,
              backgroundColor: alpha(error.main, 0.1),
            },
          },
          text: {
            '&:hover': { backgroundColor: alpha(primary.main, 0.08) },
          },
          textSecondary: {
            color: text.secondary,
            '&:hover': {
              color: text.primary,
              backgroundColor: alpha(text.primary, 0.06),
            },
          },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: {
            minWidth: touch,
            minHeight: touch,
            borderRadius: t.radii.control,
            color: text.secondary,
            transition: `background-color ${msFast} ease, color ${msFast} ease`,
            '&:hover': {
              backgroundColor: alpha(primary.main, 0.1),
              color: text.primary,
            },
            '&.Mui-focusVisible': {
              outline: `2px solid ${alpha(primary.main, 0.5)}`,
              outlineOffset: 2,
            },
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: t.radii.control,
            fontWeight: 600,
            height: 28,
          },
          outlined: { borderColor: border },
          sizeSmall: { height: 24 },
        },
      },
      MuiTextField: {
        defaultProps: { variant: 'outlined', size: 'medium' },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: t.radii.input,
            backgroundColor: alpha(surface.sunken, 0.85),
            overflow: 'hidden',
            transition: `background-color ${msFast} ease, box-shadow ${msFast} ease`,
            '&:hover': { backgroundColor: surface.sunken },
            '&:hover .MuiOutlinedInput-notchedOutline': {
              borderColor: alpha(primary.main, 0.45),
            },
            '&.Mui-focused': {
              backgroundColor: background.paper,
              boxShadow: `0 0 0 3px ${alpha(primary.main, 0.2)}`,
            },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
              borderColor: primary.main,
              borderWidth: 1,
            },
            '&.Mui-error': {
              boxShadow: `0 0 0 3px ${alpha(error.main, 0.16)}`,
            },
            '&.Mui-disabled': {
              backgroundColor: alpha(text.disabled, 0.06),
            },
          },
          notchedOutline: { borderColor: border },
          input: {
            color: text.primary,
            // Kill Chrome/Safari autofill blue slab that floats over adornments.
            '&:-webkit-autofill': {
              WebkitTextFillColor: text.primary,
              caretColor: text.primary,
              borderRadius: 'inherit',
              transition: 'background-color 99999s ease-out 0s',
              boxShadow: `0 0 0 1000px ${surface.sunken} inset`,
              WebkitBoxShadow: `0 0 0 1000px ${surface.sunken} inset`,
            },
            '&:-webkit-autofill:hover': {
              WebkitTextFillColor: text.primary,
              boxShadow: `0 0 0 1000px ${surface.sunken} inset`,
              WebkitBoxShadow: `0 0 0 1000px ${surface.sunken} inset`,
            },
            '&:-webkit-autofill:focus': {
              WebkitTextFillColor: text.primary,
              boxShadow: `0 0 0 1000px ${background.paper} inset`,
              WebkitBoxShadow: `0 0 0 1000px ${background.paper} inset`,
            },
          },
        },
      },
      MuiInputLabel: {
        styleOverrides: { root: { color: text.secondary } },
      },
      MuiFormHelperText: {
        styleOverrides: {
          root: {
            marginLeft: 4,
            fontSize: t.typography.caption.fontSize,
          },
        },
      },
      MuiTableHead: {
        styleOverrides: {
          root: {
            '& .MuiTableCell-head': {
              backgroundColor: alpha(surface.sunken, 0.98),
              color: text.secondary,
              fontWeight: 600,
              fontSize: t.typography.caption.fontSize,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              borderBottom: `1px solid ${border}`,
              paddingTop: t.spacingUnit * 1.5,
              paddingBottom: t.spacingUnit * 1.5,
            },
          },
        },
      },
      MuiTableRow: {
        styleOverrides: {
          root: {
            transition: `background-color ${msFast} ease`,
            '&.MuiTableRow-hover:hover': {
              backgroundColor: alpha(primary.main, 0.06),
            },
            '&.Mui-selected': {
              backgroundColor: alpha(primary.main, 0.12),
              '&:hover': { backgroundColor: alpha(primary.main, 0.16) },
            },
          },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          root: {
            borderBottomColor: border,
            fontSize: t.typography.body1.fontSize,
            paddingTop: t.spacingUnit * 1.5,
            paddingBottom: t.spacingUnit * 1.5,
          },
        },
      },
      MuiTableContainer: {
        styleOverrides: {
          root: {
            borderRadius: t.radii.card,
            border: `1px solid ${border}`,
            backgroundColor: background.paper,
            boxShadow: elev.level1,
            overflow: 'hidden',
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            borderRadius: t.radii.dialog,
            border: `1px solid ${border}`,
            boxShadow: elev.level4,
            backgroundImage: 'none',
            backgroundColor: background.paper,
          },
        },
      },
      MuiDialogTitle: {
        styleOverrides: {
          root: {
            fontSize: t.typography.h4.fontSize,
            fontWeight: t.typography.h4.fontWeight,
            borderBottom: `1px solid ${border}`,
            paddingTop: t.spacingUnit * 2.5,
            paddingBottom: t.spacingUnit * 2,
            paddingLeft: t.spacingUnit * 3,
            paddingRight: t.spacingUnit * 3,
          },
        },
      },
      MuiDialogContent: {
        styleOverrides: {
          root: {
            padding: t.spacingUnit * 3,
          },
        },
      },
      MuiDialogActions: {
        styleOverrides: {
          root: {
            padding: t.spacingUnit * 2.5,
            borderTop: `1px solid ${border}`,
            gap: t.spacingUnit,
          },
        },
      },
      MuiAlert: {
        styleOverrides: {
          root: {
            borderRadius: t.radii.control,
            border: `1px solid ${border}`,
          },
          standardError: {
            backgroundColor: alpha(error.main, 0.12),
            borderColor: alpha(error.main, 0.35),
          },
          standardWarning: {
            backgroundColor: alpha(warning.main, 0.12),
            borderColor: alpha(warning.main, 0.35),
          },
          standardSuccess: {
            backgroundColor: alpha(success.main, 0.12),
            borderColor: alpha(success.main, 0.35),
          },
          standardInfo: {
            backgroundColor: alpha(info.main, 0.12),
            borderColor: alpha(info.main, 0.35),
          },
        },
      },
      MuiDivider: {
        styleOverrides: { root: { borderColor: border } },
      },
      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            borderRadius: t.radii.control,
            backgroundColor: surface.overlay,
            color: text.primary,
            border: `1px solid ${border}`,
            boxShadow: elev.level2,
            fontSize: t.typography.caption.fontSize,
            padding: `${t.spacingUnit}px ${t.spacingUnit * 1.5}px`,
          },
        },
      },
      MuiMenu: {
        styleOverrides: {
          paper: {
            borderRadius: t.radii.dialog,
            border: `1px solid ${border}`,
            boxShadow: elev.level3,
            backgroundImage: 'none',
            backgroundColor: alpha(background.paper, 0.98),
            backdropFilter: 'blur(16px)',
            marginTop: 4,
          },
        },
      },
      MuiMenuItem: {
        styleOverrides: {
          root: {
            borderRadius: t.radii.control,
            marginLeft: 4,
            marginRight: 4,
            minHeight: 40,
            transition: `background-color ${msFast} ease`,
          },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: t.radii.control,
            marginLeft: t.spacingUnit,
            marginRight: t.spacingUnit,
            transition: `background-color ${msFast} ease`,
            '&.Mui-selected': {
              backgroundColor: alpha(primary.main, 0.14),
              '&:hover': { backgroundColor: alpha(primary.main, 0.2) },
            },
          },
        },
      },
      MuiLinearProgress: {
        styleOverrides: {
          root: {
            borderRadius: t.radii.pill,
            height: 6,
            backgroundColor: alpha(text.disabled, 0.2),
          },
          bar: { borderRadius: t.radii.pill },
        },
      },
      MuiSkeleton: {
        styleOverrides: {
          root: {
            backgroundColor: alpha(text.secondary, 0.1),
          },
          rounded: { borderRadius: t.radii.control },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            backgroundColor: background.paper,
            borderRight: `1px solid ${border}`,
            backgroundImage: 'none',
          },
        },
      },
      MuiBadge: {
        styleOverrides: {
          badge: { fontWeight: 700 },
        },
      },
      MuiFab: {
        styleOverrides: {
          root: {
            borderRadius: t.radii.button,
            boxShadow: elev.level3,
          },
        },
      },
      MuiSnackbarContent: {
        styleOverrides: {
          root: {
            borderRadius: t.radii.control,
            border: `1px solid ${border}`,
            backgroundColor: surface.overlay,
          },
        },
      },
      MuiSwitch: {
        styleOverrides: {
          root: {
            padding: 8,
          },
          switchBase: {
            '&.Mui-checked + .MuiSwitch-track': {
              backgroundColor: primary.main,
            },
          },
          track: {
            borderRadius: t.radii.pill,
            backgroundColor: alpha(text.secondary, 0.3),
          },
          thumb: {
            boxShadow: elev.level1,
          },
        },
      },
    },
  });
}

/** Active product theme (dark-first). */
export const appTheme: Theme = createAppTheme('dark');

/** Light theme defined for completeness; not wired in main.tsx. */
export const lightTheme: Theme = createAppTheme('light');

export { createAppTheme };
export type { ThemeMode };
