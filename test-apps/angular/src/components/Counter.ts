import { Component, OnInit, OnDestroy } from "@angular/core"
import { NanostoresService } from "@nanostores/angular"
import { Subscription } from "rxjs"
import { $count, $doubled, $displayValue, increment } from "../stores"

@Component({
	selector: "app-counter",
	template: `
		<div>
			<p>Count: {{ count }}</p>
			<p>Doubled: {{ doubled }}</p>
			<p>Display: {{ display }}</p>
			<button (click)="onIncrement()">+1</button>
		</div>
	`,
})
export class CounterComponent implements OnInit, OnDestroy {
	count = 0
	doubled = 0
	display = ""

	private subscriptions: Subscription[] = []

	constructor(private nanostores: NanostoresService) {}

	ngOnInit(): void {
		this.subscriptions.push(
			this.nanostores.useStore($count).subscribe((value) => (this.count = value)),
			this.nanostores.useStore($doubled).subscribe((value) => (this.doubled = value)),
			this.nanostores.useStore($displayValue).subscribe((value) => (this.display = value)),
		)
	}

	ngOnDestroy(): void {
		this.subscriptions.forEach((sub) => sub.unsubscribe())
	}

	onIncrement(): void {
		increment(1)
	}
}
