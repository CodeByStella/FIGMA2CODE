import React from "react";

const EmptyState = () => {
  return (
    <div className="flex w-full flex-col items-center justify-center px-4 py-12 text-center">
      {/* Illustration: a Figma-style selection box turning into code */}
      <div className="mb-4 text-neutral-700 dark:text-neutral-200">
        <svg
          width="184"
          height="120"
          viewBox="0 0 148 96"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="drop-shadow-sm"
          aria-hidden="true"
        >
          {/* Layer rectangle with selection handles */}
          <rect
            x="8"
            y="16"
            width="52"
            height="64"
            rx="4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeDasharray="4 3"
            className="text-green-400"
          />
          {/* Selection handles */}
          <rect
            x="5"
            y="13"
            width="6"
            height="6"
            rx="1"
            className="fill-green-400"
          />
          <rect
            x="5"
            y="77"
            width="6"
            height="6"
            rx="1"
            className="fill-green-400"
          />
          <rect
            x="57"
            y="13"
            width="6"
            height="6"
            rx="1"
            className="fill-green-400"
          />
          <rect
            x="57"
            y="77"
            width="6"
            height="6"
            rx="1"
            className="fill-green-400"
          />

          {/* Inner content lines (representing layer content) */}
          <rect
            x="18"
            y="30"
            width="32"
            height="3"
            rx="1.5"
            className="fill-neutral-500 dark:fill-neutral-400"
          />
          <rect
            x="18"
            y="39"
            width="24"
            height="3"
            rx="1.5"
            className="fill-neutral-400 dark:fill-neutral-500"
          />
          <rect
            x="18"
            y="54"
            width="28"
            height="3"
            rx="1.5"
            className="fill-neutral-500 dark:fill-neutral-400"
          />
          <rect
            x="18"
            y="63"
            width="18"
            height="3"
            rx="1.5"
            className="fill-neutral-400 dark:fill-neutral-500"
          />

          {/* Arrow */}
          <path
            d="M72 48 L84 48"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            className="text-neutral-500 dark:text-neutral-400"
          />
          <path
            d="M81 44 L85 48 L81 52"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-neutral-500 dark:text-neutral-400"
          />

          {/* Code block */}
          <rect
            x="92"
            y="20"
            width="52"
            height="56"
            rx="4"
            className="fill-neutral-900 stroke-neutral-700 dark:fill-neutral-800 dark:stroke-neutral-600"
            strokeWidth="1"
          />
          {/* Code lines */}
          <rect
            x="100"
            y="32"
            width="20"
            height="2.5"
            rx="1.25"
            className="fill-green-400/80"
          />
          <rect
            x="104"
            y="40"
            width="28"
            height="2.5"
            rx="1.25"
            className="fill-neutral-500 dark:fill-neutral-400"
          />
          <rect
            x="104"
            y="48"
            width="22"
            height="2.5"
            rx="1.25"
            className="fill-neutral-500 dark:fill-neutral-400"
          />
          <rect
            x="104"
            y="56"
            width="16"
            height="2.5"
            rx="1.25"
            className="fill-neutral-600 dark:fill-neutral-500"
          />
          <rect
            x="100"
            y="64"
            width="12"
            height="2.5"
            rx="1.25"
            className="fill-green-400/80"
          />
        </svg>
      </div>

      {/* Copy */}
      <h3 className="text-[15px] font-medium text-neutral-800 dark:text-neutral-200">
        Nothing selected
      </h3>
      <p className="mt-2 max-w-[280px] text-sm leading-5 text-neutral-600 dark:text-neutral-400">
        Select a frame to generate code. Use Download ZIP for index.html +
        assets.
      </p>
    </div>
  );
};

export default EmptyState;
