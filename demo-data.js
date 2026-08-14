window.G10_DEMO = {
  profile: {
    uid: "demo-student",
    studentId: "2026-10001",
    fullName: "JUAN DELA CRUZ",
    section: "GRADE 10 - DEMO SECTION",
    role: "student",
    active: true
  },

  settings: {
    schoolYear: "2026-2027",
    currentTerm: 1,
    latestLessonTitle: "Introduction to Arduino",
    latestActivityTitle: "Mini PETA 3 - Emergency Lights",
    announcement: "Welcome to the Grade 10 Arduino learning hub."
  },

  lessons: [
    {
      id: "demo-lesson-1",
      title: "Introduction to Arduino",
      description: "Arduino Uno, basic parts, and how a simple circuit works.",
      term: 1,
      order: 1,
      fileId: "",
      fileName: "Introduction-to-Arduino.pdf",
      fileType: "application/pdf",
      fileSize: 2400000,
      published: true,
      allowedSections: ["GRADE 10 - DEMO SECTION"]
    },
    {
      id: "demo-lesson-2",
      title: "Digital Output and LEDs",
      description: "Using digital pins, resistors, LEDs, HIGH, LOW, and delay().",
      term: 1,
      order: 2,
      fileId: "",
      fileName: "Digital-Output-and-LEDs.pdf",
      fileType: "application/pdf",
      fileSize: 1700000,
      published: true,
      allowedSections: ["GRADE 10 - DEMO SECTION"]
    }
  ],

  activities: [
    {
      id: "demo-activity-1",
      title: "Mini PETA 3 - Emergency Lights",
      description: "Build a two-color red and blue emergency-light sequence using Arduino.",
      term: 1,
      order: 1,
      dueDate: "2026-08-21",
      fileId: "",
      fileName: "Mini-PETA-3-Emergency-Lights.pdf",
      fileType: "application/pdf",
      published: true,
      allowedSections: ["GRADE 10 - DEMO SECTION"]
    }
  ],

  compliance: {
    term: 1,
    lastUpdated: "2026-08-14T20:35:00+08:00",
    tasks: [
      {
        taskId: "mini-peta-3",
        displayName: "Mini PETA 3 - Emergency Lights",
        status: "excellent",
        percentageBand: "green",
        practicalExam: false
      },
      {
        taskId: "mini-peta-2",
        displayName: "Mini PETA 2 - Basic Arduino Circuit",
        status: "missing",
        percentageBand: "red",
        practicalExam: false,
        missing: true,
        missingReason: "No submission recorded yet."
      },
      {
        taskId: "practical-exam",
        displayName: "Practical Exam",
        status: "excellent",
        percentageBand: "green",
        practicalExam: true,
        score: 38,
        maxScore: 40,
        missing: false
      }
    ]
  }
};
