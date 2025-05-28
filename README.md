🧾 Defensive Publication: Visual Scene Language (VSL)

Author: Maxim Zhadobin
Publication Date: 28.05.2025
Version: v0.1

⸻

📘 Invention Title

Method for Representing and Editing Visual Scenes for Language Models via a Structured Format: Visual Scene Language (VSL)

⸻

📌 Application Domains
	•	Artificial Intelligence and Large Language Models (LLMs)
	•	Image generation and editing
	•	UX/UI design
	•	Architecture, Engineering, and Construction (AEC)
	•	2D/3D modeling, AR/VR

⸻

🧠 Abstract

A method is proposed for describing visual scenes in a machine-readable format interpretable by language models (LLMs). The format is a structured JSON schema containing:
	•	canvas parameters (dimensions, measurement units, background),
	•	a list of objects (type, size, coordinates, anchor points),
	•	optional styles and object relationships.

An LLM can use this structure:
	•	to understand the image as a meaningful scene,
	•	to edit the scene based on textual commands,
	•	to generate a new scene,
	•	to reconstruct an image from the JSON.

⸻

🔄 Technological Workflow
	1.	An image is converted into a JSON-based scene structure (VSL).
	2.	The LLM interprets and modifies the JSON in response to a text prompt.
	3.	The modified JSON is rendered into a new image.
	4.	The cycle may repeat iteratively.

⸻

🧩 Distinctive Features
	•	Unlike generative models (DALL·E, Midjourney), this method separates the semantic structure of the scene from its visual rendering.
	•	Unlike scene graphs in computer graphics, VSL is optimized for language models and semantic processing.
	•	The method does not require a visual interface — interaction occurs through structure and natural language commands.

⸻

💡 Example Applications
	•	Editing user interfaces, slides, and illustrations without a visual editor.
	•	Generating AR/VR scenes from textual scenarios.
	•	Interactive assistants working with visual objects.
	•	Robotics: LLM perceives the environment through VSL and gives structured commands.
	•	Architectural and engineering design: users describe a building or structure via text; the LLM generates a corresponding VSL structure. A renderer builds a 2D/3D model from it. Edits are made via natural language and reflected in the scene. The system can also validate design choices against regulatory standards.

⸻

📜 Legal Status

This document is published with the intent to prevent patent claims by third parties. The author waives exclusive patent rights in favor of public use but formally asserts authorship, concept origin, and publication date.

⸻

📎 Attachments (to be included in GitHub repository)
	•	vsl_scene_example.json: example scene with a red rectangle
	•	llm_prompts_examples.md: prompt examples for modifying the scene
	•	vsl_to_image.py: Python script to visualize the JSON scene
	•	vsl_editor_mockup.ipynb: (optional) Jupyter Notebook mock editor
	•	Extended format specs: styles, materials, animation, 3D coordinates, behavioral logic

⸻

🔖 License

Creative Commons Attribution 4.0 International (CC BY 4.0)

⸻

“Visual Scene Language is not just a way to describe an image — it is a language for spatial thinking by artificial intelligence.”
