import personaData from "../data/persona.json" with { type: "json" };

export class PersonaService {
    private persona: any;

    constructor() {
        this.persona = personaData.persona;
    }

    getPersona(): any {
        return this.persona;
    }

    getFormattedPersona(): string {
        const lines: string[] = [];
        const processObj = (obj: any, prefix = "") => {
            for (const [key, value] of Object.entries(obj)) {
                if (typeof value === "object" && value !== null && !Array.isArray(value)) {
                    processObj(value, prefix ? `${prefix} ${key}` : key);
                } else if (Array.isArray(value)) {
                    lines.push(`${prefix ? prefix + " " : ""}${key}: ${value.join(", ")}`);
                } else {
                    lines.push(`${prefix ? prefix + " " : ""}${key}: ${value}`);
                }
            }
        };
        processObj(this.persona);
        return lines.join("\n");
    }
}
