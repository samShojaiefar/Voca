import { FONTS, type FontId } from "./setup.types";

type Props = {
  font: FontId;
  onChoose: (id: FontId) => void;
  onBack: () => void;
  onNext: () => void;
};

export function FontStep({ font, onChoose, onBack, onNext }: Props) {
  return (
    <div className="setup-step font-step">
      <h2 className="setup-title">Choose a font</h2>
      <p className="setup-subtitle">Used for the text shown in the notch.</p>

      <div className="font-options" role="radiogroup" aria-label="Notch font">
        {FONTS.map((option) => {
          const selected = option.id === font;

          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`font-option${selected ? " is-selected" : ""}`}
              onClick={() => onChoose(option.id)}
            >
              <span
                className="font-sample"
                style={{ fontFamily: option.cssVar }}
              >
                Dictating…
              </span>
              <span className="font-label">{option.label}</span>
              <span className="font-desc">{option.desc}</span>
            </button>
          );
        })}
      </div>

      <div className="setup-actions">
        <button type="button" className="setup-btn secondary" onClick={onBack}>
          Back
        </button>
        <button type="button" className="setup-btn primary" onClick={onNext}>
          Next
        </button>
      </div>
    </div>
  );
}