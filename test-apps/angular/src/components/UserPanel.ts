import { Component } from "@angular/core"
import { NanostoresService } from "@nanostores/angular"
import { Observable } from "rxjs"
import { $user, $theme, updateUser } from "../stores"

@Component({
	selector: "app-user-panel",
	template: `
		<div [class]="theme$ | async">
			<p *ngIf="(user$ | async) as user">{{ user.name }} ({{ user.email }})</p>
			<button (click)="login()">Login</button>
		</div>
	`,
})
export class UserPanelComponent {
	user$: Observable<{ name: string; email: string; role: string }>
	theme$: Observable<"light" | "dark">

	constructor(private nanostores: NanostoresService) {
		this.user$ = this.nanostores.useStore($user)
		this.theme$ = this.nanostores.useStore($theme)
	}

	login(): void {
		updateUser("Alice", "alice@test.com")
	}
}
