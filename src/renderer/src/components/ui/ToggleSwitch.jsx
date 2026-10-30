/**
 * Premium Glowing Toggle Switch Component for Settings
 */
export default function ToggleSwitch({ checked = false, onChange = () => {}, id = undefined }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary/40 ${
        checked
          ? 'bg-gradient-to-r from-[#19D8FF] to-[#3388FF] shadow-[0_0_12px_rgba(25,216,255,0.5)]'
          : 'bg-[#102449]'
      }`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  )
}

