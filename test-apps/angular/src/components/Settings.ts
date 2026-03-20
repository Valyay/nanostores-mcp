import { Component } from "@angular/core"
import { NanostoresService } from "@nanostores/angular"
import { $router, $batchedTotal, $theme } from "../stores"

@Component({
	selector: "app-settings",
	template: `
		<div>
			<p>Total: {{ total }}</p>
			<p>Theme: {{ theme }}</p>
		</div>
	`,
})
export class SettingsComponent {
	total = 0
	theme = ""

	constructor(private ns: NanostoresService) {
		this.ns.useStore($router).subscribe()
		this.ns.useStore($batchedTotal).subscribe((value) => (this.total = value))
		this.ns.useStore($theme).subscribe((value) => (this.theme = value))
	}
}
