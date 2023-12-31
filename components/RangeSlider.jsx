import { useState } from "react"
import classNames from "classnames"
import styles from "./RangeSlider.scss"

const RangeSlider = ({ id, min = 0, max = 10, step = 1, label, value, onChange,
    valueChangeOnMouseUp = false, valueToDescription }) => {
  const [currentValue, setCurrentValue] = useState(value)

  const [description, setDescription] = useState()
  const [descriptionVisible, setDescriptionVisible] = useState(false)
  const [descriptionPosition, setDescriptionPosition] = useState(0)

  function onChangeInternal(e) {
    let v = +e.target.value

    setCurrentValue(v)
    if (!valueChangeOnMouseUp && onChange) {
      onChange(v)
    }

    if (valueToDescription) {
      setDescription(valueToDescription(v))
    } else {
      setDescription(v)
    }
    setDescriptionPosition((v - min) * 100 / (max - min))
  }

  function onMouseDownInternal() {
    setDescriptionVisible(true)
  }

  function onMouseUpInternal() {
    if (valueChangeOnMouseUp && onChange) {
      onChange(currentValue)
    }
    setDescriptionVisible(false)
  }

  return (<>
    <div className="range-slider">
      <label htmlFor={id} className="form-label">{label}</label>
      <input type="range" id={id} className="form-range" min={min} max={max} step={step}
        value={currentValue} onChange={onChangeInternal}
        onMouseDown={onMouseDownInternal} onMouseUp={onMouseUpInternal} />
      <div className="description-container">
        {description && <div className={classNames("description", { visible: descriptionVisible })}
          style={{ left: `${descriptionPosition}%` }}>{description}</div>}
      </div>
    </div>
    <style jsx>{styles}</style>
  </>)
}

export default RangeSlider
